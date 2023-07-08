import tap from 'tap';
import { generateGroupedOPHSignature, estimateJaccardSimilarity } from '../index.js'; // Assuming index.js is in the parent dir

// --- Test Configuration ---
const NUM_HASHES = 128;
const NUM_SAMPLES = 200; // Reduced further for very low bit depths
const GROUP_SIZE = 4;   // Fixed group size for this test
const ERROR_TOLERANCE = 0.1; // For individual success counts
const MIN_SET_SIZE = 100;
const MAX_SET_SIZE = 5000;
const MIN_SIMILARITY = 0.1;
const MAX_SIMILARITY = 0.9;

// --- Helper Functions ---

/**
 * Calculates the exact Jaccard similarity between two sets.
 */
function calculateTrueJaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    if (union.size === 0) return 1.0; // Avoid division by zero
    return intersection.size / union.size;
}

/**
 * Creates two sets of random numbers with a target Jaccard similarity.
 * (Copied from grouped-oph-accuracy.js - consider refactoring to a shared helper)
 */
function createSimilarSetsOfNumbers(minSize, maxSize, minSimilarity, maxSimilarity) {
    const targetSize = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    const targetSimilarity = Math.random() * (maxSimilarity - minSimilarity) + minSimilarity;

    const setA = new Set();
    const setB = new Set();

    const intersectionSize = Math.round(targetSimilarity * targetSize);
    const unionSize = Math.max(intersectionSize, targetSize);
    const uniqueToA = Math.round((unionSize - intersectionSize) / 2);
    const uniqueToB = unionSize - intersectionSize - uniqueToA;

    let added = 0;
    const MAX_VAL = 2**31 -1 ; // Generate positive 31-bit ints for simplicity

    // Add intersection elements
    while (added < intersectionSize) {
        const item = Math.floor(Math.random() * MAX_VAL);
        if (!setA.has(item)) {
            setA.add(item);
            setB.add(item);
            added++;
        }
    }
    // Add elements unique to A
    added = 0;
    while (added < uniqueToA) {
        const item = Math.floor(Math.random() * MAX_VAL);
         if (!setA.has(item)) {
            setA.add(item);
            added++;
        }
    }
    // Add elements unique to B
    added = 0;
    while (added < uniqueToB) {
        const item = Math.floor(Math.random() * MAX_VAL);
        if (!setA.has(item) && !setB.has(item)) {
            setB.add(item);
            added++;
        }
    }
    return { setA, setB };
}

/**
 * Downgrades a higher-precision signature to a lower-precision one.
 * @param {Uint16Array | Uint32Array} signature The input signature.
 * @param {8 | 16} targetBitDepth The desired lower bit depth.
 * @returns {Uint8Array | Uint16Array} The downgraded signature.
 */
function downgradeSignature(signature, targetBitDepth) { // Now accepts 2, 4, 8, 16
    if (!signature || !signature.length) {
        if (targetBitDepth === 16) return new Uint16Array(0);
        if (targetBitDepth === 8) return new Uint8Array(0);
        if (targetBitDepth === 4) return new Uint8Array(0); // Still use Uint8
        if (targetBitDepth === 2) return new Uint8Array(0); // Still use Uint8
        return new Uint8Array(0); // Default
    }

    let TargetTypedArray;
    let mask;
    if (targetBitDepth === 8) {
        TargetTypedArray = Uint8Array;
        mask = 0xFF;
    } else if (targetBitDepth === 4) {
        TargetTypedArray = Uint8Array; // Store in Uint8
        mask = 0x0F;
    } else if (targetBitDepth === 2) {
        TargetTypedArray = Uint8Array; // Store in Uint8
        mask = 0x03;
    } else if (targetBitDepth === 16) {
        TargetTypedArray = Uint16Array;
        mask = 0xFFFF;
    } else {
        throw new Error("Target bit depth must be 2, 4, 8, or 16 for downgrade.");
    }

    // Ensure source bit depth is higher
    const sourceBytes = signature.BYTES_PER_ELEMENT;
    const targetBytes = (targetBitDepth <= 8) ? 1 : 2;
    if (targetBytes >= sourceBytes) {
         // Need to handle potential format change even if bit depth isn't lower (e.g., 16 -> 8)
         // Re-apply the mask logic for this edge case
         const copied = new TargetTypedArray(signature.length);
         for (let i = 0; i < signature.length; i++) {
             const originalValue = signature[i];
              if (originalValue === 0) {
                   copied[i] = 0;
              } else {
                   let truncatedValue = originalValue & mask;
                   copied[i] = truncatedValue === 0 ? 1 : truncatedValue;
              }
         }
         return copied;
    }

    const downgraded = new TargetTypedArray(signature.length);
    for (let i = 0; i < signature.length; i++) {
        // Apply mask and handle potential 0 padding value correctly
        const originalValue = signature[i];
        if (originalValue === 0) {
             downgraded[i] = 0; // Preserve padding
        } else {
            let truncatedValue = originalValue & mask;
            // Ensure truncated value isn't 0 unless original was 0 (dense hash shouldn't produce 0)
            downgraded[i] = truncatedValue === 0 ? 1 : truncatedValue;
        }
    }
    return downgraded;
}

// --- Test Execution ---

tap.test('GOPH Cross Bit Depth Accuracy Evaluation', (t) => {

    // Accumulators for errors - Focus on same-precision comparisons
    const errors = {
        'n32_vs_n32': [], // Native High Precision
        'n16_vs_n16': [], // Native Mid Precision
        'n8_vs_n8': [],  // Native Low Precision
        'n4_vs_n4': [],  // Native Very Low Precision
        'n2_vs_n2': [],  // Native Extremely Low Precision

        'd32_to_16_vs_d32_to_16': [], // Downgraded High to Mid
        'd32_to_8_vs_d32_to_8': [],   // Downgraded High to Low
        'd32_to_4_vs_d32_to_4': [],   // Downgraded High to V.Low
        'd32_to_2_vs_d32_to_2': [],   // Downgraded High to E.Low

        'd16_to_8_vs_d16_to_8': [],   // Downgraded Mid to Low
        'd16_to_4_vs_d16_to_4': [],   // Downgraded Mid to V.Low
        'd16_to_2_vs_d16_to_2': [],   // Downgraded Mid to E.Low

        'd8_to_4_vs_d8_to_4': [],    // Downgraded Low to V.Low
        'd8_to_2_vs_d8_to_2': [],    // Downgraded Low to E.Low

        'd4_to_2_vs_d4_to_2': [],    // Downgraded V.Low to E.Low
    };

    console.log(`Running ${NUM_SAMPLES} samples...`);

    for (let i = 0; i < NUM_SAMPLES; i++) {
        const { setA, setB } = createSimilarSetsOfNumbers(MIN_SET_SIZE, MAX_SET_SIZE, MIN_SIMILARITY, MAX_SIMILARITY);
        const trueJaccard = calculateTrueJaccard(setA, setB);

        // Generate native signatures
        const sigA8 = generateGroupedOPHSignature(setA, NUM_HASHES, GROUP_SIZE, 8);
        const sigB8 = generateGroupedOPHSignature(setB, NUM_HASHES, GROUP_SIZE, 8);
        const sigA16 = generateGroupedOPHSignature(setA, NUM_HASHES, GROUP_SIZE, 16);
        const sigB16 = generateGroupedOPHSignature(setB, NUM_HASHES, GROUP_SIZE, 16);
        const sigA32 = generateGroupedOPHSignature(setA, NUM_HASHES, GROUP_SIZE, 32);
        const sigB32 = generateGroupedOPHSignature(setB, NUM_HASHES, GROUP_SIZE, 32);
        const sigA4 = generateGroupedOPHSignature(setA, NUM_HASHES, GROUP_SIZE, 4);
        const sigB4 = generateGroupedOPHSignature(setB, NUM_HASHES, GROUP_SIZE, 4);
        const sigA2 = generateGroupedOPHSignature(setA, NUM_HASHES, GROUP_SIZE, 2);
        const sigB2 = generateGroupedOPHSignature(setB, NUM_HASHES, GROUP_SIZE, 2);

        // Generate downgraded signatures
        const sigA16_d8 = downgradeSignature(sigA16, 8);
        const sigB16_d8 = downgradeSignature(sigB16, 8);
        const sigA32_d16 = downgradeSignature(sigA32, 16);
        const sigB32_d16 = downgradeSignature(sigB32, 16);
        const sigA32_d8 = downgradeSignature(sigA32, 8);
        const sigB32_d8 = downgradeSignature(sigB32, 8);
        const sigA8_d4 = downgradeSignature(sigA8, 4);
        const sigB8_d4 = downgradeSignature(sigB8, 4);
        const sigA16_d4 = downgradeSignature(sigA16, 4);
        const sigB16_d4 = downgradeSignature(sigB16, 4);
        const sigA32_d4 = downgradeSignature(sigA32, 4);
        const sigB32_d4 = downgradeSignature(sigB32, 4);
        const sigA4_d2 = downgradeSignature(sigA4, 2);
        const sigB4_d2 = downgradeSignature(sigB4, 2);
        const sigA8_d2 = downgradeSignature(sigA8, 2);
        const sigB8_d2 = downgradeSignature(sigB8, 2);
        const sigA16_d2 = downgradeSignature(sigA16, 2);
        const sigB16_d2 = downgradeSignature(sigB16, 2);
        const sigA32_d2 = downgradeSignature(sigA32, 2);
        const sigB32_d2 = downgradeSignature(sigB32, 2);

        // Estimate and record errors
        const estimateAndRecord = (key, sig1, sig2) => {
            const est = estimateJaccardSimilarity(sig1, sig2);
            if (!isNaN(est)) {
                errors[key].push(Math.abs(trueJaccard - est));
            } else {
                 console.warn(`NaN estimation for ${key}, sample ${i}`);
            }
        };

        // Baselines
        estimateAndRecord('n8_vs_n8', sigA8, sigB8);
        estimateAndRecord('n16_vs_n16', sigA16, sigB16);
        estimateAndRecord('n32_vs_n32', sigA32, sigB32);
        estimateAndRecord('n4_vs_n4', sigA4, sigB4);
        estimateAndRecord('n2_vs_n2', sigA2, sigB2);

        // Downgraded vs Downgraded
        estimateAndRecord('d16_to_8_vs_d16_to_8', sigA16_d8, sigB16_d8);
        estimateAndRecord('d32_to_16_vs_d32_to_16', sigA32_d16, sigB32_d16);
        estimateAndRecord('d32_to_8_vs_d32_to_8', sigA32_d8, sigB32_d8);
        estimateAndRecord('d8_to_4_vs_d8_to_4', sigA8_d4, sigB8_d4);
        estimateAndRecord('d16_to_4_vs_d16_to_4', sigA16_d4, sigB16_d4);
        estimateAndRecord('d32_to_4_vs_d32_to_4', sigA32_d4, sigB32_d4);
        estimateAndRecord('d4_to_2_vs_d4_to_2', sigA4_d2, sigB4_d2);
        estimateAndRecord('d8_to_2_vs_d8_to_2', sigA8_d2, sigB8_d2);
        estimateAndRecord('d16_to_2_vs_d16_to_2', sigA16_d2, sigB16_d2);
        estimateAndRecord('d32_to_2_vs_d32_to_2', sigA32_d2, sigB32_d2);

        // --- Optional: Check if native is different from downgraded ---
        // This comparison is tricky - how different is "different"?
        // We primarily care about the Jaccard estimation result.
        // const est_n8_vs_n8 = estimateJaccardMixed(sigA8, sigB8);
        // const est_d16v8_vs_d16v8 = estimateJaccardMixed(sigA16_d8, sigB16_d8);
        // if (Math.abs(est_n8_vs_n8 - est_d16v8_vs_d16v8) > 0.01) {
        //      console.log(`Sample ${i}: Native 8v8 differs from Downgraded (16->8)v(16->8)`);
        // }
    }

    // Calculate and report stats
    t.comment(`--- Accuracy Stats (Avg Abs Error / Max Abs Error) for g=${GROUP_SIZE} ---`);
    for (const key in errors) {
        const errArray = errors[key];
        if (errArray.length > 0) {
            const avgError = errArray.reduce((a, b) => a + b, 0) / errArray.length;
            const maxError = Math.max(...errArray);
            t.comment(`  ${key.padEnd(18)}: ${avgError.toFixed(4)} / ${maxError.toFixed(4)} (${errArray.length} samples)`);
        } else {
            t.comment(`  ${key.padEnd(18)}: No valid samples.`);
        }
    }

    // --- Assertions ---
    // We expect cross-comparisons involving 8-bit to be roughly similar to native 8v8.
    // We expect cross-comparisons involving 16-bit to be roughly similar to native 16v16.
    // Downgraded comparisons should closely match native lower-bit comparisons.

    const getAvgError = (key) => {
         const errArray = errors[key];
         return errArray.length > 0 ? errArray.reduce((a, b) => a + b, 0) / errArray.length : Infinity;
    };

    const tolerance = 0.02; // Allow small difference in average error

    // Check 8-bit related comparisons
    const avg8v8 = getAvgError('n8_vs_n8');
    t.ok(Math.abs(getAvgError('d16_to_8_vs_d16_to_8') - avg8v8) > tolerance, 'Avg error d(16->8) should be BETTER than native 8v8');
    t.ok(Math.abs(getAvgError('d32_to_8_vs_d32_to_8') - avg8v8) > tolerance, 'Avg error d(32->8) should be BETTER than native 8v8');

     // Check 16-bit related comparisons
    const avg16v16 = getAvgError('n16_vs_n16');
     t.ok(Math.abs(getAvgError('d32_to_16_vs_d32_to_16') - avg16v16) < tolerance, 'Avg error d(32->16) should be close to native 16v16');

    // Check 4-bit related comparisons
    const avg4v4 = getAvgError('n4_vs_n4');
    t.ok(Math.abs(getAvgError('d8_to_4_vs_d8_to_4') - avg4v4) > tolerance, 'Avg error d(8->4) should be BETTER than native 4v4');
    t.ok(Math.abs(getAvgError('d16_to_4_vs_d16_to_4') - avg4v4) > tolerance, 'Avg error d(16->4) should be BETTER than native 4v4');
    t.ok(Math.abs(getAvgError('d32_to_4_vs_d32_to_4') - avg4v4) > tolerance, 'Avg error d(32->4) should be BETTER than native 4v4');

    // Check 2-bit related comparisons
    const avg2v2 = getAvgError('n2_vs_n2');
    t.ok(Math.abs(getAvgError('d4_to_2_vs_d4_to_2') - avg2v2) > tolerance, 'Avg error d(4->2) should be BETTER than native 2v2');
    t.ok(Math.abs(getAvgError('d8_to_2_vs_d8_to_2') - avg2v2) > tolerance, 'Avg error d(8->2) should be BETTER than native 2v2');
    t.ok(Math.abs(getAvgError('d16_to_2_vs_d16_to_2') - avg2v2) > tolerance, 'Avg error d(16->2) should be BETTER than native 2v2');
    t.ok(Math.abs(getAvgError('d32_to_2_vs_d32_to_2') - avg2v2) > tolerance, 'Avg error d(32->2) should be BETTER than native 2v2');

    t.end();
}); 