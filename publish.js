import dotenv from "dotenv";
import bsv from "bsv";
import Arc from "./Arc.js"; // Import the Arc class
import { toExtendedFormat } from "./extendedFormat.js";
import getUtxos from "./utxoMgr.js";

dotenv.config();

const PUBLISHING_WIF = process.env.PUBLISHING_WIF;
const PUBLISHING_ADDRESS = process.env.PUBLISHING_ADDRESS;
const PUBLISHING_PUBLIC_KEY = process.env.PUBLISHING_PUBLIC_KEY;
// Create an instance of Arc with optional API credentials.
const arc = new Arc({
  apiKey: process.env.ARC_API_KEY,
  authToken: process.env.ARC_AUTH_TOKEN,
  batchSize: process.env.BATCH_SIZE || 1000, // default to 150 if not set
});

/**
 * Helper function that creates a signed transaction string
 * embedding the given JSON payload using the provided UTXO.
 */
function createTxString(json, utxo) {
  const tx = new bsv.Transaction();
  tx.from({
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    script: utxo.script,
  });
  const userString = typeof json === "object" ? JSON.stringify(json) : json;
  const weatherchainTag = [
    "1L7qHn17m2TP66yjU3XYoBYq6mv3QxkASS",
    userString,
    "application/json",
    "utf8",
  ];

  const safeDataString = "1L7qHn17m2TP66yjU3XYoBYq6mv3QxkASS"; //weatherchain

  const weatherchainData = weatherchainTag.map((s) => Buffer.from(s));
  tx.addOutput(
    new bsv.Transaction.Output({
      script: bsv.Script.buildSafeDataOut(weatherchainData),
      satoshis: 0,
    })
  );
  // tx.addOutput(
  //   new bsv.Transaction.Output({
  //     script: bsv.Script.buildSafeDataOut(opReturnData),
  //     satoshis: 0,
  //   })
  // );
  const publicKeyHash = bsv.Script.buildPublicKeyHashOut(PUBLISHING_ADDRESS);
  // Build a custom locking script that embeds the JSON payload.
  const lockingScript = new bsv.Script();
  lockingScript.add(bsv.Opcode.OP_FALSE);
  lockingScript.add(bsv.Opcode.OP_IF);
  lockingScript.add(Buffer.from("1L7qHn17m2TP66yjU3XYoBYq6mv3QxkASS"));
  lockingScript.add(bsv.Opcode.OP_1);
  lockingScript.add(Buffer.from("application/json"));
  lockingScript.add(bsv.Opcode.OP_0);
  lockingScript.add(Buffer.from(userString));
  lockingScript.add(bsv.Opcode.OP_ENDIF);
  lockingScript.add(bsv.Opcode.OP_DUP);
  lockingScript.add(bsv.Opcode.OP_HASH160);
  lockingScript.add(Buffer.from(PUBLISHING_PUBLIC_KEY));
  lockingScript.add(bsv.Opcode.OP_EQUALVERIFY);
  lockingScript.add(bsv.Opcode.OP_CHECKSIG);

  tx.addOutput(
    new bsv.Transaction.Output({
      satoshis: 1,
      script: lockingScript,
    })
  );

  // Sign the transaction using the publishing private key.
  const privateKey = bsv.PrivateKey.fromWIF(PUBLISHING_WIF);
  tx.sign(privateKey);

  const txid = tx.id;
  const extendedTxString = toExtendedFormat(tx, [utxo]);
  return { txid, extendedTxString };
}

/**
 * Publishes a single JSON object as a transaction using one UTXO.
 */
async function publishJson(json) {
  while (true) {
    try {
      // Fetch one UTXO in a single API call.
      const utxos = await getUtxos(1);
      if (!utxos || utxos.length === 0) {
        throw new Error("No publishing UTXO found in DB");
      }
      console.log("Publishing UTXO:", utxos[0]);

      const { txid, extendedTxString } = createTxString(json, utxos[0]);
      const result = await arc.submitTransaction(extendedTxString);
      if (!result.success) {
        throw new Error(`Transaction broadcast error: ${result.error}`);
      }
      console.log(`Published JSON with txid: ${txid}`);
      return txid;
    } catch (error) {
      console.error("Error publishing JSON:", error);
      throw error;
    }
  }
}

/**
 * Publishes an array of JSON objects by creating a transaction for each.
 * Fetches all required UTXOs in one call upfront, then processes them in batches of 50 via the Arc API.
 */
async function publishBatchJson(arrayJsonObjects, full = false) {
  if (!Array.isArray(arrayJsonObjects) || arrayJsonObjects.length === 0) {
    throw new Error("Invalid or empty array of JSON objects provided.");
  }

  const results = [];
  const batchSize = process.env.BATCH_SIZE || 1000;

  // Fetch all required UTXOs in one call upfront
  const totalUtxosNeeded = arrayJsonObjects.length;
  const utxos = await getUtxos(totalUtxosNeeded);
  if (!utxos || utxos.length < totalUtxosNeeded) {
    throw new Error(
      `Not enough UTXOs for the batch. Needed ${totalUtxosNeeded}, got ${utxos.length}`
    );
  }
  console.log(
    `Fetched ${utxos.length} UTXOs for ${totalUtxosNeeded} JSON objects`
  );

  // Process the JSON objects in chunks of batchSize
  for (let i = 0; i < arrayJsonObjects.length; i += batchSize) {
    const chunk = arrayJsonObjects.slice(i, i + batchSize);
    const utxoChunk = utxos.slice(i, i + batchSize); // Use corresponding UTXOs

    const transactions = [];
    // Create a transaction for each JSON object using one UTXO
    for (let j = 0; j < chunk.length; j++) {
      try {
        const txData = createTxString(chunk[j], utxoChunk[j]);
        console.log(
          `Created transaction for JSON object ${
            i + j + 1
          } with txid ${txData.txid}`
        );
        transactions.push(txData);
      } catch (error) {
        console.error("Error creating transaction for JSON:", error);
        throw error;
      }
    }

    // Publish the batch of transaction strings
    try {
      const txStrings = transactions.map((tx) => tx.extendedTxString);
      console.log(`Publishing a batch of ${txStrings.length} transactions`);
      const batchResult = await arc.submitBulkTransactions(txStrings);
      console.log("Batch published. Results:", batchResult);
      results.push({
        batchResult,
        txids: transactions.map((t) => t.txid),
      });
    } catch (error) {
      console.error("Error publishing batch transactions:", error);
      throw error;
    }
  }

  const txids = [];
  // Extract the txid from the batch results
  results.forEach((result) => {
    txids.push(...result.txids);
  });

  if (full) {
    return results.map((r) => r.batchResult);
  }
  return txids;
}

async function verifySignature(json) {
  const signature = bsv.crypto.Signature.fromString(json.signature);
  const publicKey = bsv.PublicKey.fromString(json.publicKey);
  const hash = Buffer.from(json.hash, "hex");
  return bsv.crypto.ECDSA.verify(hash, signature, publicKey);
}

// Example main function to demonstrate publishing
async function main() {
  const privateKey1 = bsv.PrivateKey.fromRandom();
  const publicKey1 = privateKey1.toPublicKey();
  const data = "Hello, World!";
  const hash = bsv.crypto.Hash.sha256(Buffer.from(data, "utf8"));
  const signature = bsv.crypto.ECDSA.sign(hash, privateKey1);

  const json = {
    signature: signature.toString(),
    publicKey: publicKey1.toString(),
    hash: hash.toString("hex"),
  };

  console.log("Publishing single JSON with hash:", hash.toString("hex"));
  const txid = await publishJson(json);
  console.log("Signature verified:", await verifySignature(json));
  console.log("Transaction ID:", txid);

  // Demonstrate batch publishing with two sample JSON objects
  const batchResults = await publishBatchJson([json, json]);
  console.log("Batch publish results:", batchResults);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(console.error);
}

export { publishJson, publishBatchJson };
