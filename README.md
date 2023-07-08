# goph - Grouped One Permutation Hashing

[![npm package](https://nodei.co/npm/goph.png?downloads=true&stars=true)](https://nodei.co/npm/goph/)

Fast, compact MinHash signatures using Grouped One Permutation Hashing (GOPH). Useful for estimating Jaccard similarity between sets of numerical features (e.g., shingle hashes).

This library provides functions to generate GOPH sketches (signatures) with configurable bit depths (2, 4, 8, 16, 32 bits per hash value) and to compare these sketches.

## Features

- Generates GOPH signatures from sets of numerical element hashes.
- Supports multiple bit depths (2, 4, 8, 16, 32) for signature values, allowing trade-offs between accuracy and size.
- Estimates Jaccard similarity between signatures.
- Includes utility to downgrade signature precision (see "Signature Downgrading Accuracy" below).
- Uses a subtly modified MurmurHash3 for internal hashing.

## Usage

```javascript
import {
    generateGroupedOPHSignature,
    estimateJaccardSimilarity,
    downgradeSignature,
    getBitDepth,
    murmurhash3_32_gc_single_int // also murmurhash3_32_gc, hashStringFNV1a
} from 'goph';

// Example: Generate a signature for a set of element hashes
const elementHashes = new Set([12345, 67890, 24680, 13579]);

// Configuration
const numTotalHashes = 128; // Total desired length of the signature
const numGroups = 4;      // Number of base hashes per element (g)
                          // numTotalHashes must be divisible by numGroups

// Generate a 32-bit signature (default)
const signature32bit = generateGroupedOPHSignature(
    elementHashes,
    numTotalHashes,
    numGroups
);
console.log('32-bit Signature (first 10 values):', signature32bit.slice(0, 10));

// Generate an 8-bit signature
const signature8bit = generateGroupedOPHSignature(
    elementHashes,
    numTotalHashes,
    numGroups,
    8 // bitDepth
);
console.log('8-bit Signature (first 10 values):', signature8bit.slice(0, 10));

// Example: Estimate Jaccard Similarity
const setA = new Set([1, 2, 3, 4, 5]);
const setB = new Set([4, 5, 6, 7, 8]);

const sigA = generateGroupedOPHSignature(setA, 128, 4, 16);
const sigB = generateGroupedOPHSignature(setB, 128, 4, 16);

const similarity = estimateJaccardSimilarity(sigA, sigB);
console.log('Estimated Jaccard Similarity (16-bit):', similarity); // Should be 2/8 = 0.25

// Example: Downgrade a signature
const highPrecisionSig = generateGroupedOPHSignature(elementHashes, 128, 4, 32);
const lowerPrecisionSig = downgradeSignature(highPrecisionSig, 8);
console.log('Downgraded to 8-bit (first 10 values):', lowerPrecisionSig.slice(0, 10));
console.log('Bit depth of downgraded signature:', getBitDepth(lowerPrecisionSig)); // Output: 8

// Using a hashing function directly (e.g., for preparing elementHashes)
const itemHash = murmurhash3_32_gc_single_int(123456789, 0); // Hash an integer
console.log('MurmurHash3 of an integer:', itemHash);
```

## API

### `generateGroupedOPHSignature(elementHashSet, numHashes, numGroups, bitDepth = 32)`

*   `elementHashSet` (Iterable<number>): An iterable (e.g., Set, Array) of numerical element hashes.
*   `numHashes` (number): Total desired length of the signature (must be divisible by `numGroups`).
*   `numGroups` (number): Number of base hashes computed per element (g).
*   `bitDepth` (number, default: `32`): Desired bit depth for each hash value (2, 4, 8, 16, or 32).
*   **Returns**: `Uint8Array | Uint16Array | Uint32Array` - The GOPH signature.

### `estimateJaccardSimilarity(signatureA, signatureB)`

*   `signatureA` (TypedArray): First signature.
*   `signatureB` (TypedArray): Second signature.
*   **Returns**: `number` - Estimated Jaccard similarity (0 to 1).
    Throws an error if signatures are null, or not of equal length.

### `downgradeSignature(signature, targetBitDepth)`

*   `signature` (TypedArray): The original signature.
*   `targetBitDepth` (number): Desired lower bit depth (2, 4, 8, 16). Must be lower than the signature's current bit depth.
*   **Returns**: `TypedArray` - The new signature with downgraded bit depth.

### `getBitDepth(signature)`
*   `signature` (TypedArray): The signature array.
*   **Returns**: `number | null` - The bit depth (e.g., 8, 16, 32) or `null` if unrecognized.

### Hashing Utilities
*   `murmurhash3_32_gc(keyString, seed)`: Hashes a string using MurmurHash3.
*   `murmurhash3_32_gc_single_int(integer, seed)`: Hashes a single integer using MurmurHash3.
*   `hashStringFNV1a(str)`: Hashes a string using FNV-1a.

## Benchmarks

Results from `node goph/benchmarks/index.js`:

| Operation                       | Configuration                                     | Performance (approx)         |
|---------------------------------|---------------------------------------------------|------------------------------|
| `generateGroupedOPHSignature` | 50k sets (avg size 50), sig size 128, 4 groups, 32-bit | 206,611 sigs/sec           |
| `estimateJaccardSimilarity`   | 100k estimations, sig size 128, 32-bit            | 4,545,454 estimations/sec |
| `downgradeSignature`            | 32-bit to 8-bit                                   | 990,099 downgrades/sec    |


## Signature Downgrading Accuracy

A key feature is the ability to `downgradeSignature` from a higher precision to a lower one. Benchmarks (`test/cross-bit-depth-accuracy.js`) show that **downgrading a higher-precision signature often yields better Jaccard estimation accuracy compared to generating a signature natively at the target lower bit depth.**

For example, when comparing average absolute error in Jaccard estimation (lower is better), using g=4 and 200 samples:

| Comparison Scenario                      | Avg. Abs. Error (Downgraded) | Avg. Abs. Error (Native Low Precision) |
|------------------------------------------|------------------------------|----------------------------------------|
| 32-bit downgraded to 8-bit vs. Native 8-bit | 0.0309                       | 0.0837                                 |
| 32-bit downgraded to 4-bit vs. Native 4-bit | 0.0432                       | 0.4372                                 |
| 32-bit downgraded to 2-bit vs. Native 2-bit | 0.1848                       | 0.4800                                 |
| 16-bit downgraded to 8-bit vs. Native 8-bit | 0.0280                       | 0.0837                                 |
| 16-bit downgraded to 4-bit vs. Native 4-bit | 0.0423                       | 0.4372                                 |

This suggests a clear strategy: For optimal accuracy and flexibility, it's generally recommended to generate signatures at a higher precision, such as 32-bit. If you need to transmit or store them more compactly (e.g., sending to a client or for storage in memory-constrained environments), you can then downgrade them to a lower bit depth like 8-bit. This approach typically yields better Jaccard estimation accuracy than generating signatures natively at the lower bit depth.

For instance, to optimize for transmission, you could calculate signatures server-side as 32-bit, then downgrade them to 8-bit before shipping them to the client or storing them for later, less-critical comparisons.

## Why GOPH?

Grouped One Permutation Hashing offers a good balance between the accuracy of traditional MinHash (which often requires many hash functions) and the speed of One Permutation Hashing (OPH), which can sometimes suffer in accuracy. By computing a small number of base hashes (`numGroups`) per element and deriving multiple signature values from them, GOPH provides strong accuracy with fewer hash computations than standard MinHash for a given signature length.

This makes it suitable for applications where both speed and signature quality are important, such as large-scale similarity detection.


## Hold up, why did you reimplement murmur hash?

BECAUSE. I DIDN'T LIKE THE OTHER ONES, FOR REASONS (speed, incompatibility with cloudflare workers, native bindings weren't compiling nice, wanted to skip string assumptions, mood)

## Installation

```bash
npm install goph
```

(Assuming this package is published. For local use: `npm install ./goph` from parent dir, or use local path.)

## License

MIT
