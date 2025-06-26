// Specification

// Current Transaction format:
// Field 	Description 	Size
// Version no 	currently 2 	4 bytes
// In-counter 	positive integer VI = [[VarInt]] 	1 - 9 bytes
// list of inputs 	Transaction Input Structure 	qty with variable length per input
// Out-counter 	positive integer VI = [[VarInt]] 	1 - 9 bytes
// list of outputs 	Transaction Output Structure 	qty with variable length per output
// nLocktime 	if non-zero and sequence numbers are < 0xFFFFFFFF: block height or timestamp when transaction is final 	4 bytes

// The Extended Format adds a marker to the transaction format:
// Field 	Description 	Size
// Version no 	currently 2 	4 bytes
// EF marker 	marker for extended format 	0000000000EF
// In-counter 	positive integer VI = [[VarInt]] 	1 - 9 bytes
// list of inputs 	Extended Format transaction Input Structure 	qty with variable length per input
// Out-counter 	positive integer VI = [[VarInt]] 	1 - 9 bytes
// list of outputs 	Transaction Output Structure 	qty with variable length per output
// nLocktime 	if non-zero and sequence numbers are < 0xFFFFFFFF: block height or timestamp when transaction is final 	4 bytes

// The Extended Format marker allows a library that supports the format to recognize that it is dealing with a transaction in extended format, while a library that does not support extended format will read the transaction as having 0 inputs, 0 outputs and a future nLock time. This has been done to minimize the possible problems a legacy library will have when reading the extended format. It can in no way be recognized as a valid transaction.

// The input structure is the only additional thing that is changed in the Extended Format. The current input structure looks like this:
// Field 	Description 	Size
// Previous Transaction hash 	TXID of the transaction the output was created in 	32 bytes
// Previous Txout-index 	Index of the output (Non negative integer) 	4 bytes
// Txin-script length 	Non negative integer VI = VarInt 	1 - 9 bytes
// Txin-script / scriptSig 	Script 	-many bytes
// Sequence_no 	Used to iterate inputs inside a payment channel. Input is final when nSequence = 0xFFFFFFFF 	4 bytes

// In the Extended Format, we extend the input structure to include the previous locking script and satoshi outputs:
// Field 	Description 	Size
// Previous Transaction hash 	TXID of the transaction the output was created in 	32 bytes
// Previous Txout-index 	Index of the output (Non negative integer) 	4 bytes
// Txin-script length 	Non negative integer VI = VarInt 	1 - 9 bytes
// Txin-script / scriptSig 	Script 	-many bytes
// Sequence_no 	Used to iterate inputs inside a payment channel. Input is final when nSequence = 0xFFFFFFFF 	4 bytes
// Previous TX satoshi output 	Output value in satoshis of previous input 	8 bytes
// Previous TX script length 	Non negative integer VI = VarInt 	1 - 9 bytes
// Previous TX locking script 	Script 	<script length>-many bytes

import bsv from "bsv";
import { Buffer } from "buffer";

/**
 * Serializes a bsv.Transaction object into the Extended Format hex string.
 *
 * @param {bsv.Transaction} tx The transaction to serialize.
 * @param {Array<Object>} utxos The list of UTXOs being spent by the transaction's inputs.
 * Each UTXO object must have `satoshis` and `script` (hex string of scriptPubKey).
 * The order of UTXOs must match the order of inputs in the transaction.
 * @returns {string} The transaction in extended format as a hex string.
 */
export function toExtendedFormat(tx, utxos) {
  const writer = new bsv.encoding.BufferWriter();

  // Version
  writer.writeUInt32LE(tx.version);

  // EF Marker (6 bytes)
  // This makes legacy parsers read tx_in_count=0, tx_out_count=0,
  // and a future nLockTime from the first 6 bytes of the marker.
  writer.write(Buffer.from("0000000000EF", "hex"));

  // In-counter
  writer.writeVarintNum(tx.inputs.length);

  // List of inputs (extended)
  tx.inputs.forEach((input, i) => {
    const utxo = utxos[i];
    if (!utxo || typeof utxo.satoshis === "undefined" || !utxo.script) {
      throw new Error(`UTXO data missing for input ${i}`);
    }

    // Previous Transaction hash
    writer.writeReverse(input.prevTxId);

    // Previous Txout-index
    writer.writeUInt32LE(input.outputIndex);

    // Txin-script / scriptSig
    const scriptSig = input.script.toBuffer();
    writer.writeVarintNum(scriptSig.length);
    writer.write(scriptSig);

    // Sequence_no
    writer.writeUInt32LE(input.sequenceNumber);

    // Previous TX satoshi output
    writer.writeUInt64LEBN(new bsv.crypto.BN(utxo.satoshis));

    // Previous TX locking script
    const scriptPubKey = bsv.Script.fromHex(utxo.script).toBuffer();
    writer.writeVarintNum(scriptPubKey.length);
    writer.write(scriptPubKey);
  });

  // Out-counter
  writer.writeVarintNum(tx.outputs.length);

  // List of outputs
  tx.outputs.forEach((output) => {
    output.toBufferWriter(writer);
  });

  // nLocktime
  writer.writeUInt32LE(tx.nLockTime);

  return writer.toBuffer().toString("hex");
}
