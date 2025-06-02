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
    var i = 0;
    for (;i< len; i++) {
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

const N_APPROX_THRESHOLD = 30; // Threshold for n_trials to consider normal approximation

/**
 * @private
 * Calculates the Binomial Cumulative Distribution Function P(X <= k)
 * for X ~ Bin(n, p).
 * Uses an optimized iterative method for summing PMF terms.
 * @param {number} k_to_sum - The value k (number of successes) to sum up to (inclusive).
 * @param {number} n_trials - The number of trials (n).
 * @param {number} p_success - The probability of success for a single trial (p).
 * @returns {number} P(X <= k_to_sum).
 */
function _binomialCDF(k_to_sum, n_trials, p_success, mean_in, stdDev_in) {
    if (k_to_sum < 0) return 0;
    if (k_to_sum >= n_trials) return 1;

    if (p_success === 0) return 1;
    if (p_success === 1) return k_to_sum >= n_trials ? 1 : 0;

    const np = n_trials * p_success;
    const nq = n_trials * (1 - p_success);

    if (n_trials > N_APPROX_THRESHOLD && np >= 5 && nq >= 5) {
        return _normalApproxBinomialCDF(k_to_sum, n_trials, p_success, mean_in, stdDev_in);
    }

    let sum_prob = 0;
    let current_pmf_term = Math.pow(1 - p_success, n_trials); // P(X=0)

    if (0 <= k_to_sum) {
        sum_prob += current_pmf_term;
    }

    // P(i) = P(i-1) * (n-i+1)/i * p/(1-p)
    for (let i = 1; i <= k_to_sum; i++) {
        if (current_pmf_term === 0 && p_success > 0) {
             break;
        }
        const factor = ((n_trials - i + 1) / i) * (p_success / (1 - p_success));
        current_pmf_term *= factor;
        sum_prob += current_pmf_term;

        if (sum_prob > 1.0 && sum_prob < 1.000000001) { // Handle minor floating point overflow
            sum_prob = 1.0;
        }
    }
    return Math.min(sum_prob, 1.0);
}

/**
 * @private
 * Approximates the Binomial Cumulative Distribution Function P(X <= k)
 * for X ~ Bin(n, p) using the Normal Approximation with continuity correction.
 * This is generally faster for large n.
 * Conditions for good approximation: n*p >= 5 and n*(1-p) >= 5.
 * @param {number} k_to_sum - The value k (number of successes) to sum up to (inclusive).
 * @param {number} n_trials - The number of trials (n).
 * @param {number} p_success - The probability of success for a single trial (p).
 * @returns {number} Approximate P(X <= k_to_sum).
 */
function _normalApproxBinomialCDF(k_to_sum, n_trials, p_success, mean_in, stdDev_in) {
    if (k_to_sum < 0) return 0;
    if (k_to_sum >= n_trials) return 1;

    if (p_success === 0) return 1;
    if (p_success === 1) return k_to_sum >= n_trials ? 1 : 0;

    const mean = (mean_in === undefined) ? n_trials * p_success : mean_in;
    const stdDev = (stdDev_in === undefined) ? Math.sqrt(n_trials * p_success * (1 - p_success)) : stdDev_in;

    if (stdDev === 0) {
        return k_to_sum >= mean ? 1.0 : 0.0;
    }

    const x_corrected = k_to_sum + 0.5; // Continuity correction
    const z = (x_corrected - mean) / stdDev;

    // Standard Normal CDF: Φ(z) = 0.5 * (1 + erf(z / sqrt(2)))
    const normalCDF = 0.5 * (1 + Math.erf(z / Math.sqrt(2)));
    
    return Math.max(0, Math.min(normalCDF, 1.0));
}

// Polyfill for Math.erf if not available
if (typeof Math.erf !== 'function') {
    // Abramowitz and Stegun approximation for erf(x) 
    const p = 0.3275911;
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;

    Math.erf = function(x) {
        // Save the sign of x
        let sign = 1;
        if (x < 0) {
            sign = -1;
        }
        x = Math.abs(x);

        // A&S formula 7.1.26
        const t = 1.0 / (1.0 + p * x);
        const y = ((((a5 * t + a4) * t) + a3) * t + a2) * t + a1;
        const result = 1.0 - y * Math.exp(-x * x);
        
        return sign * result;
    };
}

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
 * Estimates Jaccard similarity between two Grouped MinHash signatures.
 * Assumes signatures were generated with the same number of hash functions and compatible settings.
 * Handles signatures of different bit depths by attempting to downgrade the higher precision one.
 *
 * @param {Uint8Array|Uint16Array|Uint32Array|Array<number>} signatureA - First signature.
 * @param {Uint8Array|Uint16Array|Uint32Array|Array<number>} signatureB - Second signature.
 * @param {object} options - Optional options object
 * @param {number} options.numGroups - Number of groups the signature was generated with
 * @param {number} options.similarityThreshold - Optional T from paper (target Jaccard index)
 * @param {number} options.errorTolerance - Optional epsilon from paper (acceptable error probability for early exit)
 * @param {number} options.maxGroups - Optional limit on number of groups to use (for fast approximation)
 * @returns {number} The estimated Jaccard similarity.
 */
export function estimateJaccardSimilarity(
    signatureA,
    signatureB,
    options = {}
) {
    if (!signatureA || !signatureB || signatureA.length !== signatureB.length) {
        throw new Error("Signatures must be non-null and of equal length.");
    }
    if (signatureA.length === 0) return 1.0; // Or 0.0 if definitionally no items? Paper implies 1.0 for empty sets.

    const currentOptions = options === null ? {} : options;

    const {
        numGroups,         // Number of groups the signature was generated with
        similarityThreshold,   // Optional T from paper (target Jaccard index)
        errorTolerance,        // Optional epsilon from paper (acceptable error probability for early exit)
        maxGroups              // Optional limit on number of groups to use (for fast approximation)
    } = currentOptions;

    const hasStatisticalEarlyTermination = similarityThreshold !== undefined || errorTolerance !== undefined;
    const hasFastMode = maxGroups !== undefined;
    const needsNumGroups = hasStatisticalEarlyTermination || hasFastMode;

    if (needsNumGroups) {
        if (
            typeof numGroups !== 'number' || numGroups <= 0 ||
            !Number.isInteger(numGroups) ||
            signatureA.length % numGroups !== 0
        ) {
            throw new Error("Invalid or missing 'numGroups' for optimized similarity estimation. It must be a positive integer and a divisor of signature length.");
        }
        
        // Validate statistical early termination parameters if any are provided
        if (hasStatisticalEarlyTermination) {
            if (typeof similarityThreshold !== 'number' || similarityThreshold < 0 || similarityThreshold > 1) {
                throw new Error("Invalid or missing 'similarityThreshold' for optimized similarity estimation. It must be a number between 0 and 1.");
            }
            if (typeof errorTolerance !== 'number' || errorTolerance <= 0 || errorTolerance >= 1) {
                throw new Error("Invalid or missing 'errorTolerance' for optimized similarity estimation. It must be a number > 0 and < 1.");
            }
        }
        
        if (hasFastMode && (typeof maxGroups !== 'number' || maxGroups <= 0 || !Number.isInteger(maxGroups) || maxGroups > numGroups)) {
            throw new Error("Invalid 'maxGroups' for fast approximation. It must be a positive integer <= numGroups.");
        }
    } else {
        let matches = 0;
        let unionCount = 0;
        const len = signatureA.length;
        for (let i = 0; i < len; i++) {
            const valA = signatureA[i];
            const valB = signatureB[i];
            if (valA !== 0 || valB !== 0) { // If the slot is active in either signature
                unionCount++;
                if (valA === valB && valA !== 0) { // Match if equal and not "empty"
                    matches++;
                }
            }
        }
        return unionCount === 0 ? 1.0 : matches / unionCount;
    }

    // Optimized path with early termination
    const n_total_hashes = signatureA.length;
    const k_prime = n_total_hashes / numGroups; // k' in paper (bins per group)
    const T = similarityThreshold;
    const epsilon = errorTolerance;

    // Pre-calculate constants to avoid repeated computation
    const Ma = k_prime * T; // Ma from paper (target matches in a group if overall sim=T)
    const total_target_matches_overall = numGroups * Ma; // numGroups * k_prime * T
    const np_approx = k_prime * T;
    const nq_approx = k_prime * (1 - T);

    // Pre-calculate mean and stdDev for normal approximation if it's likely to be used
    let precalc_norm_mean;
    let precalc_norm_stdDev;
    if (hasStatisticalEarlyTermination && k_prime > N_APPROX_THRESHOLD && np_approx >= 5 && nq_approx >= 5) {
        precalc_norm_mean = np_approx;
        precalc_norm_stdDev = Math.sqrt(np_approx * (1 - T));
    }

    let Mc = 0; // current total matched bins where valA === valB && valA !== 0
    let final_unionCount = 0; // Calculate union count as we go to avoid second pass
    
    // Determine how many groups to actually process
    const effectiveNumGroups = hasFastMode ? Math.min(maxGroups, numGroups) : numGroups;
    
    for (let l_group_idx = 0; l_group_idx < effectiveNumGroups; l_group_idx++) {
        let current_group_matches = 0;
        const group_start_offset = l_group_idx * k_prime;
        const group_end_offset = group_start_offset + k_prime;

        // Single loop to count matches and union elements for this group
        for (let sig_idx = group_start_offset; sig_idx < group_end_offset; sig_idx++) {
            const valA = signatureA[sig_idx];
            const valB = signatureB[sig_idx];
            
            // Count union elements
            if (valA !== 0 || valB !== 0) {
                final_unionCount++;
            }
            
            // Count matches
            if (valA === valB && valA !== 0) {
                current_group_matches++;
            }
        }
        
        Mc += current_group_matches;

        // Skip early exit check for last group
        if (l_group_idx === effectiveNumGroups - 1) {
            break;
        }

        // Early exit logic - cache denominator calculation
        const remaining_groups = effectiveNumGroups - (l_group_idx + 1);
        
        // Adjust target matches for the effective number of groups we're using
        const effective_target_matches = hasFastMode ? effectiveNumGroups * Ma : total_target_matches_overall;
        const Mra = (effective_target_matches - Mc) / remaining_groups;

        // Only do statistical early exit if we have both optimization parameters
        if (!hasStatisticalEarlyTermination || similarityThreshold === undefined || errorTolerance === undefined) {
            continue; // Skip early exit logic, just compute with limited groups
        }

        let prob_of_undesired_outcome;
        if (Mra < Ma) {
            // Trending "better" than T. Concerned about dropping below T.
            prob_of_undesired_outcome = _binomialCDF(Math.floor(Mra - 1e-9), k_prime, T, precalc_norm_mean, precalc_norm_stdDev);
            if (prob_of_undesired_outcome <= epsilon) {
                // Confident it's above threshold - estimate final similarity
                // Estimate remaining union count based on current ratio
                const processed_elements = (l_group_idx + 1) * k_prime;
                const union_ratio = final_unionCount / processed_elements;
                const estimated_total_union = union_ratio * n_total_hashes;
                
                // Estimate remaining matches based on current match rate
                const match_ratio = Mc / processed_elements;
                const estimated_total_matches = match_ratio * n_total_hashes;
                
                return estimated_total_union === 0 ? 1.0 : estimated_total_matches / estimated_total_union;
            }
        } else { // Mra >= Ma (Trending "worse" than T or on track)
            // Use pre-calculated ceiling to avoid repeated Math.ceil calls
            const ceiling_Mra = Math.ceil(Mra - 1e-9);
            prob_of_undesired_outcome = 1 - _binomialCDF(ceiling_Mra - 1, k_prime, T, precalc_norm_mean, precalc_norm_stdDev);
            if (prob_of_undesired_outcome <= epsilon) {
                return 0.0; // Confidently dissimilar
            }
        }
    }

    // Return final similarity using the groups we processed (all or limited by maxGroups)
    return final_unionCount === 0 ? 1.0 : Mc / final_unionCount;
}
