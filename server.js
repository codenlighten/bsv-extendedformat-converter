import express from 'express';
import bsv from 'bsv';
import { toExtendedFormat } from './extendedFormat.js';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Swagger definition
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'BSV Extended Format Converter API',
      version: '1.0.0',
      description: 'An API to convert standard Bitcoin SV (BSV) transactions to the extended format.',
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
      },
    ],
  },
  apis: ['./server.js'], // files containing annotations as above
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /convert:
 *   post:
 *     summary: Convert a standard BSV transaction to extended format
 *     description: Takes a standard transaction hex and the UTXOs it spends, and returns the transaction in the extended format.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHex
 *               - utxos
 *             properties:
 *               txHex:
 *                 type: string
 *                 description: The raw transaction in hexadecimal format.
 *                 example: "0200000001..."
 *               utxos:
 *                 type: array
 *                 description: An array of UTXOs being spent by the transaction's inputs. The order must match the inputs.
 *                 items:
 *                   type: object
 *                   required:
 *                     - satoshis
 *                     - script
 *                   properties:
 *                     satoshis:
 *                       type: number
 *                       description: The amount of satoshis in the UTXO.
 *                       example: 10000
 *                     script:
 *                       type: string
 *                       description: The hex-encoded locking script (scriptPubKey) of the UTXO.
 *                       example: "76a914...88ac"
 *     responses:
 *       200:
 *         description: The transaction in extended format.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 extendedFormatTx:
 *                   type: string
 *                   description: The transaction serialized in the extended format as a hex string.
 *       400:
 *         description: Invalid input. The request body is missing required fields or the number of UTXOs does not match the number of inputs.
 *       500:
 *         description: Internal server error.
 */

app.post('/convert', (req, res) => {
    const { txHex, utxos } = req.body;

    if (!txHex || !utxos || !Array.isArray(utxos) || utxos.length === 0) {
        return res.status(400).json({ 
            error: 'Invalid request. Please provide txHex and an array of utxos.' 
        });
    }

    try {
        const tx = new bsv.Transaction(txHex);

        // The bsv library automatically adds inputs from the raw tx, 
        // but we need to ensure the utxos match the inputs.
        if (tx.inputs.length !== utxos.length) {
            return res.status(400).json({
                error: 'The number of UTXOs does not match the number of inputs in the transaction.'
            });
        }

        const extendedFormatTx = toExtendedFormat(tx, utxos);
        res.json({ extendedFormatTx });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
