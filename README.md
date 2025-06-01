# GroupedOPH - Grouped One Permutation Hashing

[![npm package](https://nodei.co/npm/grouped-oph.png?downloads=true&stars=true)](https://nodei.co/npm/grouped-oph/)

Fast, compact MinHash signatures using Grouped One Permutation Hashing (GroupedOPH). Useful for estimating Jaccard similarity between sets of numerical features (e.g., shingle hashes).

This library provides functions to generate GroupedOPH sketches (signatures) with configurable bit depths (2, 4, 8, 16, 32 bits per hash value) and a rapid approximate way to compare these sketches.

## Features

- Generates GroupedOPH signatures from sets of numerical element hashes.
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
} from 'grouped-oph';

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
*   **Returns**: `Uint8Array | Uint16Array | Uint32Array` - The GroupedOPH signature.

### `estimateJaccardSimilarity(signatureA, signatureB, options = {})`

*   `signatureA` (TypedArray): First signature.
*   `signatureB` (TypedArray): Second signature.
*   `options` (object, optional): Configuration for similarity estimation.
    *   `numGroups` (number): The number of groups the signatures were generated with. **Required if using other optimization options.** Must be a positive integer, and `signatureA.length` must be divisible by `numGroups`.
    *   `similarityThreshold` (number): The Jaccard similarity threshold (0 to 1) for early termination. If the algorithm can confidently determine that the true similarity is above or below this threshold with an error probability less than `errorTolerance`, it may return an approximate result early. **Required if using other optimization options.**
    *   `errorTolerance` (number): The acceptable probability (0 to 1, e.g., 0.01 for 1%) of making an incorrect early termination decision. **Required if using other optimization options.**
*   **Returns**: `number` - Estimated Jaccard similarity (0 to 1).
    Throws an error if signatures are null, not of equal length, or if optimization options are provided incorrectly (e.g., missing one of the required fields, or `numGroups` is invalid for the given signatures). If optimization options are provided, the function may return `1.0` if it determines the sets are likely similar enough according to the threshold, or `0.0` if likely dissimilar enough, without computing the exact Jaccard index.

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

Results from `node GroupedOPH/benchmarks/index.js`:

| Operation                       | Configuration                                     | Performance (approx)         |
|---------------------------------|---------------------------------------------------|------------------------------|
| `generateGroupedOPHSignature` | 50k sets (avg size 50), sig size 128, 4 groups, 32-bit | 205,761 sigs/sec            |
| `estimateJaccardSimilarity`   | 100k estimations, sig size 128, 32-bit            | 4,347,826 estimations/sec |
| `downgradeSignature`            | 32-bit to 8-bit                                   | 1,111,111 downgrades/sec   |

Below are more detailed benchmarks for `estimateJaccardSimilarity`, including the early termination optimization. The "Optimized" scenarios use `numGroups: 4`, and signatures are 32-bit, 128 hashes long. The actual Jaccard similarity of the test signatures is ≈ 0.5.

| `estimateJaccardSimilarity` Scenario                        | Target Threshold (T) | Error Tolerance (eps) | Performance (approx)          | Notes                                                                          |
|-------------------------------------------------------------|----------------------|-----------------------|-------------------------------|--------------------------------------------------------------------------------|
| Optimized (Std Eps)                                         | 0.9                  | 0.001                 | 9,091,000 estimations/sec   | Threshold far from actual; confident early exit (rounded).                 |
| High Threshold, Moderate Eps (T=0.8, eps=0.10)              | 0.8                  | 0.10                  | 7,143,000 estimations/sec   | Threshold far from actual; confident early exit (moderate eps, rounded). |
| Optimized (Std Eps)                                         | 0.1                  | 0.001                 | 4,762,000 estimations/sec   | Threshold far from actual; confident early exit (rounded).                 |
| **Baseline (Full Comparison)**                              | N/A                  | N/A                   | **4,348,000 estimations/sec** | Baseline performance (rounded for table consistency).                  |
| Optimized (Aggressive Eps)                                  | 0.55                 | 0.15                  | 4,348,000 estimations/sec   | Threshold very close; aggressive epsilon allows more early exits (rounded). |
| Optimized (Aggressive Eps)                                  | 0.45                 | 0.15                  | 3,030,000 estimations/sec   | Threshold very close; aggressive epsilon allows more early exits (rounded). |
| Optimized (Std Eps)                                         | 0.6                  | 0.001                 | 3,333,000 estimations/sec   | Threshold closer to actual; normal approx. aids (rounded).               |
| Optimized (Std Eps)                                         | 0.4                  | 0.001                 | 1,923,000 estimations/sec   | Threshold closer to actual; normal approx. aids (rounded).               |

This shows that the early termination provides a significant speedup when the similarity threshold is clearly different from the actual similarity of the pair, allowing for a confident early decision. If the threshold is very close to the actual similarity, the overhead of the checks for early termination might result in slower performance than a direct full comparison, unless a more aggressive error tolerance is used which might allow for faster (though potentially less accurate) decisions. 

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

## Why Grouped OPH?

One Permutation Hashing (OPH) techniques, such as those explored by Li, Owen, and Zhang (2012, [arXiv:1208.1259](https://arxiv.org/abs/1208.1259)), offer improved efficiency over traditional k-permutation MinHash. GroupedOPH builds on this by allowing a configurable number of groups (`numGroups`). This acts as a slider: `numGroups = 1` approaches the speed of basic OPH, while a higher `numGroups` (e.g., 4, as recommended for this library) increases precision, more closely approximating the accuracy of traditional MinHash but with significantly fewer computations overall. The result is a library that offers a good balance, providing strong accuracy and speed, making it suitable for applications where both are important, such as large-scale similarity detection.

It's worth noting that the term "GOPH" also appears in other research with different specific mechanics—a bit of a "convergent evolution" scenario, as the core signature generation in this library was developed independently! For example, the GOPH described by Zhang et al. in "Hierarchical One Permutation Hashing: Efficient Multimedia Near Duplicate Detection" (2018, [arXiv:1805.11254v2](https://arxiv.org/abs/1805.11254)) primarily detailed an optimized *comparison strategy* for OPH-generated fingerprints, using probabilistic early termination to speed up similarity estimation. After a helpful tip from a friend about this paper, this library has now adopted a similar early-termination strategy (the one described by Zhang et al.) for its `estimateJaccardSimilarity` function when provided with appropriate options (see API docs and benchmark table), offering further speedups in certain scenarios. The original signature generation method in this library remains distinct, focusing on `numGroups` to structure the MinHash signature directly.


## Hold up, why did you reimplement murmur hash?

BECAUSE. I DIDN'T LIKE THE OTHER ONES, FOR REASONS (speed, incompatibility with cloudflare workers, native bindings weren't compiling nice, wanted to skip string assumptions, mood)

## Installation

```bash
npm install grouped-oph
```

(Assuming this package is published. For local use: `npm install ./GroupedOPH` from parent dir, or use local path.)

## License

MIT
