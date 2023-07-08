/**
 * @fileoverview Implementation of Grouped One Permutation Hashing (GOPH).
 * Provides functions to generate GOPH signatures and estimate Jaccard similarity.
 */

/**
 * Basic 32-bit FNV-1a hash function for strings (used for shingling).
 * @param {string} str The string to hash.
 * @returns {number} A 32-bit integer hash.
 */
function hashStringFNV1a(str) {
    let hash = 2166136261;
    const len = str.length;
    for (var i = 0;i< len; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
}


/**
 *
 * @private
 * @param {string} key ASCII only!
 * @param {number} seed Positive integer only
 * @return {number} 32-bit positive integer hash
 */
function murmurhash3_32_gc(key, seed) {
    let remainder, bytes, h1, k1;
    const keylen = key.length;

    remainder = keylen & 3;
    bytes = keylen - remainder;
    h1 = seed;
    var i = 0;
    for (; i < bytes;) {
        k1 =
            ((key.charCodeAt(i) & 0xff)) |
            ((key.charCodeAt(i+1) & 0xff) << 8) |
            ((key.charCodeAt(i+2) & 0xff) << 16) |
            ((key.charCodeAt(i+3) & 0xff) << 24);
        i += 4;

        k1 = Math.imul(k1, 0xcc9e2d51);
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = Math.imul(k1, 0x1b873593);

        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1 = Math.imul(h1, 5) + 0xe6546b64;
        h1 |= 0;
    }

    k1 = 0;

    switch (remainder) {
        case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        case 1: k1 ^= (key.charCodeAt(i) & 0xff);

        k1 = Math.imul(k1, 0xcc9e2d51);
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = Math.imul(k1, 0x1b873593);
        h1 ^= k1;
    }

    h1 ^= keylen;

    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;

    return h1 >>> 0;
}

/**
 * MurmurHash3's finalization steps for a single 32-bit integer.
 * @private
 * @param {number} h1_orig The 32-bit integer to finalize.
 * @param {number} len The length of the data that produced h1 (for a single int, effectively 4 bytes).
 * @return {number} 32-bit positive integer hash.
 */
function _murmurhash3_finalize(h1_orig, len) {
    let h1 = h1_orig;
    h1 ^= len;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;
    return h1 >>> 0;
}

/**
 * MurmurHash3 for a single 32-bit integer input.
 * Avoids string conversion.
 * @private
 * @param {number} k1_orig The 32-bit integer.
 * @param {number} seed Positive integer only.
 * @return {number} 32-bit positive integer hash.
 */
function murmurhash3_32_gc_single_int(k1_orig, seed) {
    let k1 = k1_orig;
    let h1 = seed;

    k1 = Math.imul(k1, 0xcc9e2d51);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, 0x1b873593);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = Math.imul(h1, 5) + 0xe6546b64;

    return _murmurhash3_finalize(h1, 4);
}

/**
 * Computes a dense hash value from a base hash, avoiding zero,
 * and ensuring it fits within the target bit depth.
 * Used internally by generateGroupedOPHSignature.
 * @private
 */
function _computeDenseHash(baseHash, bitDepth = 32) {
    let h = baseHash;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    h = h >>> 0;

    let mask;
    if (bitDepth === 8) {
        mask = 0xFF;
    } else if (bitDepth === 4) {
        mask = 0x0F;
    } else if (bitDepth === 2) {
        mask = 0x03;
    } else if (bitDepth === 16) {
        mask = 0xFFFF;
    } else {
        mask = 0xFFFFFFFF;
    }
    h &= mask;

    return h === 0 ? 1 : h;
}


export { murmurhash3_32_gc, murmurhash3_32_gc_single_int, hashStringFNV1a };

/**
 * Generates a MinHash signature using a "Grouped OPH" approach.
 * Computes 'g' base hashes per element and derives 'M' signature values from each.
 *
 * Recommended usage: numGroups = 4 based on accuracy/performance tests.
 * Input elements should typically be numerical hashes of the actual features (e.g., shingle hashes).
 *
 * @param {Iterable<number>} elementHashSet - An iterable (e.g., Set, Array) of numerical element hashes.
 * @param {number} numHashes - The total desired length of the signature (must be divisible by numGroups).
 * @param {number} numGroups - The number of base hashes to compute per element (g).
 * @param {number} [bitDepth=32] - The desired bit depth for each hash value in the signature (8, 16, or 32).
 * @returns {Uint8Array | Uint16Array | Uint32Array} The MinHash signature array as a TypedArray.
 */
export function generateGroupedOPHSignature(elementHashSet, numHashes, numGroups, bitDepth = 32) {
    if (typeof numHashes !== 'number' || numHashes <= 0 || !Number.isInteger(numHashes)) {
         throw new Error("numHashes must be a positive integer.");
    }
     if (typeof numGroups !== 'number' || numGroups <= 0 || !Number.isInteger(numGroups)) {
         throw new Error("numGroups must be a positive integer.");
    }
    if (numHashes % numGroups !== 0) {
        throw new Error("numHashes must be divisible by numGroups.");
    }
    if (![2, 4, 8, 16, 32].includes(bitDepth)) {
        throw new Error("bitDepth must be 2, 4, 8, 16, or 32.");
    }

    const M = numHashes / numGroups;

    let signature;
    let TypedArrayConstructor;
    let fillVal;
    if (bitDepth === 8) {
        TypedArrayConstructor = Uint8Array;
        fillVal = 0xFF;
        signature = new TypedArrayConstructor(numHashes).fill(fillVal);
    } else if (bitDepth === 4) {
        TypedArrayConstructor = Uint8Array;
        fillVal = 0x0F;
        signature = new TypedArrayConstructor(numHashes).fill(fillVal);
    } else if (bitDepth === 2) {
        TypedArrayConstructor = Uint8Array;
        fillVal = 0x03;
        signature = new TypedArrayConstructor(numHashes).fill(fillVal);
    } else if (bitDepth === 16) {
        TypedArrayConstructor = Uint16Array;
        fillVal = 0xFFFF;
        signature = new TypedArrayConstructor(numHashes).fill(fillVal);
    } else {
        TypedArrayConstructor = Uint32Array;
        fillVal = Infinity;
        signature = new Array(numHashes).fill(fillVal);
    }

    for (const elementHash of elementHashSet) {
         if (typeof elementHash !== 'number') continue;

         for (var i = 0; i < numGroups; i++) {
            const baseHash = murmurhash3_32_gc_single_int(elementHash, i);
            const j = baseHash % M;
            const h = _computeDenseHash(baseHash, bitDepth);
            const signatureIndex = i * M + j;
             if (h < signature[signatureIndex]) {
                 signature[signatureIndex] = h;
             }
        }
    }

    const sigLen = signature.length;
    for (let k = 0; k < sigLen; k++) {
        if (signature[k] === fillVal) {
            signature[k] = 0;
        }
    }

    if (bitDepth === 32) {
        return new Uint32Array(signature);
    }

    return signature;
}

/**
 * Determines the bit depth of a signature TypedArray.
 * @param {Uint8Array|Uint16Array|Uint32Array} signature The signature array.
 * @returns {number|null} The bit depth (e.g., 8, 16, 32) or null if type is unrecognized.
 */
export function getBitDepth(signature) {
    if (signature instanceof Uint8Array) return 8;
    if (signature instanceof Uint16Array) return 16;
    if (signature instanceof Uint32Array) return 32;
    return null;
}


/**
 * Downgrades a signature to a lower bit depth.
 * This is useful for comparing signatures of different precisions or for storage.
 * WARNING: This is a lossy conversion if the original values exceed the target bit depth's max.
 *
 * @param {Uint8Array|Uint16Array|Uint32Array} signature - The original signature TypedArray.
 * @param {number} targetBitDepth - The desired bit depth (2, 4, 8, 16). Must be lower than original.
 * @returns {Uint8Array|Uint16Array} The new signature with downgraded bit depth.
 */
export function downgradeSignature(signature, targetBitDepth) {
    const currentBitDepth = getBitDepth(signature);

    if (currentBitDepth === null) {
        throw new Error("Invalid or unsupported signature type for downgrade.");
    }
    if (targetBitDepth >= currentBitDepth) {
        throw new Error("Target bit depth must be lower than current bit depth for downgrade.");
    }
    if (![2, 4, 8, 16].includes(targetBitDepth)) {
        throw new Error("Target bit depth must be 2, 4, 8, or 16.");
    }

    let NewTypedArrayConstructor;
    let mask;
    if (targetBitDepth === 16) {
        NewTypedArrayConstructor = Uint16Array;
        mask = 0xFFFF;
    } else if (targetBitDepth === 8) {
        NewTypedArrayConstructor = Uint8Array;
        mask = 0xFF;
    } else if (targetBitDepth === 4) {
        NewTypedArrayConstructor = Uint8Array;
        mask = 0x0F;
    } else {
        NewTypedArrayConstructor = Uint8Array;
        mask = 0x03;
    }

    const newSignature = new NewTypedArrayConstructor(signature.length);
    const len = signature.length;
    for (var i = 0; i < len; i++) {
        const originalValue = signature[i];
        if (originalValue === 0) {
            newSignature[i] = 0;
        } else {
            let maskedValue = originalValue & mask;
            if (maskedValue === 0) {
                maskedValue = 1;
            }
            newSignature[i] = maskedValue;
    }
    }
    return newSignature;
}

/**
 * Estimates Jaccard similarity between two MinHash signatures.
 * Assumes signatures were generated with the same number of hash functions and compatible settings.
 * Handles signatures of different bit depths by attempting to downgrade the higher precision one.
 *
 * @param {Uint8Array|Uint16Array|Uint32Array|Array<number>} signatureA - First signature.
 * @param {Uint8Array|Uint16Array|Uint32Array|Array<number>} signatureB - Second signature.
 * @returns {number} The estimated Jaccard similarity.
 */
export function estimateJaccardSimilarity(signatureA, signatureB) {
    if (!signatureA || !signatureB || signatureA.length !== signatureB.length) {
        throw new Error("Signatures must be non-null and of equal length.");
    }
    if (signatureA.length === 0) return 1.0;

    let matches = 0;
    let unionCount = 0;
    const len = signatureA.length;
    var i = 0;

    for (; i < len; i++) {
        const valA = signatureA[i];
        const valB = signatureB[i];

        if (valA !== 0 || valB !== 0) { // If the slot is active in either signature
            unionCount++;
            if (valA === valB) { // This implies valA === valB !== 0 due to the outer condition
                matches++;
            }
        }
    }
    return unionCount === 0 ? 1.0 : matches / unionCount;
}
