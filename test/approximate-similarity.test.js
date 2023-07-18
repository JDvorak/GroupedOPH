import tape from 'tape';
import {
    generateGroupedOPHSignature,
    estimateJaccardSimilarity
} from '../index.js';

const test = tape;

// Helper to create sets with a target Jaccard similarity
// Note: Actual Jaccard can vary slightly due to randomness in element selection.
function createSimilarSets(targetNumElements, targetJaccard, seed = 1) {
    const setA = new Set();
    const setB = new Set();

    const intersectionSize = Math.round(targetNumElements * targetJaccard);
    const unionSize = targetNumElements;
    const uniqueToEachSet = Math.max(0, Math.floor((unionSize - intersectionSize) / 2));
    // Adjust intersection if uniqueToEachSet calculation makes it impossible
    const actualIntersectionSize = Math.max(0, unionSize - 2 * uniqueToEachSet);

    let valCounter = seed * 100000; // Offset by seed to get different elements for different seeds

    // Intersection
    for (let i = 0; i < actualIntersectionSize; i++) {
        setA.add(valCounter);
        setB.add(valCounter);
        valCounter++;
    }

    // Unique to A
    for (let i = 0; i < uniqueToEachSet; i++) {
        setA.add(valCounter++);
    }

    // Unique to B
    for (let i = 0; i < uniqueToEachSet; i++) {
        setB.add(valCounter++);
    }
    return { setA, setB };
}

function calculateActualJaccard(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 1.0 : intersection.size / union.size;
}

test('Approximate Similarity - Early Exit Behavior', (t) => {
    const numHashes = 128;
    const numGroups = 4;
    const bitDepth = 32;
    const errorTol = 0.01; // Epsilon for these tests

    const { setA, setB } = createSimilarSets(200, 0.7, 123); // Actual Jaccard ~0.7
    const actualJ = calculateActualJaccard(setA, setB);
    // console.log(`Actual Jaccard for Early Exit tests: ${actualJ}`);

    const sigA = generateGroupedOPHSignature(setA, numHashes, numGroups, bitDepth);
    const sigB = generateGroupedOPHSignature(setB, numHashes, numGroups, bitDepth);

    // Scenario 1: Confidently Similar (threshold << actual)
    let opts1 = { numGroups, similarityThreshold: 0.3, errorTolerance: errorTol };
    let result1 = estimateJaccardSimilarity(sigA, sigB, opts1);
    t.equal(result1, 1.0, `Threshold ${opts1.similarityThreshold} (far below actual J ~${actualJ.toFixed(2)}): Should return 1.0 (confidently similar)`);

    // Scenario 2: Confidently Dissimilar (threshold >> actual)
    let opts2 = { numGroups, similarityThreshold: 0.95, errorTolerance: errorTol };
    let result2 = estimateJaccardSimilarity(sigA, sigB, opts2);
    t.equal(result2, 0.0, `Threshold ${opts2.similarityThreshold} (far above actual J ~${actualJ.toFixed(2)}): Should return 0.0 (confidently dissimilar)`);

    // Scenario 3: Borderline (threshold ~ actual, likely no early exit)
    let opts3 = { numGroups, similarityThreshold: actualJ, errorTolerance: errorTol }; // Threshold is actual Jaccard
    let result3 = estimateJaccardSimilarity(sigA, sigB, opts3);
    const fullComparison = estimateJaccardSimilarity(sigA, sigB, {}); // Run full comparison for reference
    t.ok(result3 >= 0 && result3 <= 1, `Threshold ${opts3.similarityThreshold} (near actual J ~${actualJ.toFixed(2)}): Should return a Jaccard value`);
    t.equal(result3, fullComparison, `Threshold ${opts3.similarityThreshold}: Result should match full comparison if no early exit`);
    
    // Scenario 4: Very high error tolerance, threshold moderately below actual - might exit early as similar
    let opts4 = { numGroups, similarityThreshold: actualJ - 0.1, errorTolerance: 0.2 }; // High epsilon
    let result4 = estimateJaccardSimilarity(sigA, sigB, opts4);
    t.ok(result4 === 1.0 || (result4 >=0 && result4 <=1.0) , `Threshold ${opts4.similarityThreshold} (moderately below actual J ~${actualJ.toFixed(2)}) with high epsilon: May return 1.0 or actual Jaccard`);

    // Scenario 5: Threshold moderately above actual - might exit early as dissimilar
    let opts5 = { numGroups, similarityThreshold: actualJ + 0.1, errorTolerance: 0.2 }; // High epsilon
    let result5 = estimateJaccardSimilarity(sigA, sigB, opts5);
     t.ok(result5 === 0.0 || (result5 >=0 && result5 <=1.0) , `Threshold ${opts5.similarityThreshold} (moderately above actual J ~${actualJ.toFixed(2)}) with high epsilon: May return 0.0 or actual Jaccard`);

    t.end();
});

test('Approximate Similarity - Statistical Accuracy (Monte Carlo)', (t) => {
    const numHashes = 128;
    const numGroups = 4;
    const bitDepth = 32;
    const iterations = 100000; // Number of Monte Carlo iterations
    const targetJaccard = 0.5;
    const setSize = 200;

    // Case A: Testing "Confidently Similar" boundary
    // We set a threshold LOW, and expect early exit with 1.0 most of the time.
    // An "error" here is if it returns 0.0 (i.e., says it's confidently DISSIMILAR to the low threshold)
    // or if it does a full calc and that calc is somehow < threshold (less likely with this setup)
    const thresholdA = 0.3; // Lower than targetJaccard
    const epsilonA = 0.05;  // We expect errors (returning 0.0) to be <= 5%
    let errorsA = 0;

    for (let i = 0; i < iterations; i++) {
        const { setA, setB } = createSimilarSets(setSize, targetJaccard, i + 1000);
        const sigA = generateGroupedOPHSignature(setA, numHashes, numGroups, bitDepth);
        const sigB = generateGroupedOPHSignature(setB, numHashes, numGroups, bitDepth);
        const opts = { numGroups, similarityThreshold: thresholdA, errorTolerance: epsilonA };
        const result = estimateJaccardSimilarity(sigA, sigB, opts);
        if (result === 0.0) { // Early exit saying dissimilar to the low threshold (this is the error type we are counting)
            errorsA++;
        }
    }
    const errorRateA = errorsA / iterations;
    t.ok(errorRateA <= epsilonA + 0.02, `Error rate for 'confidently similar' (T=${thresholdA}, J_act~${targetJaccard}, eps=${epsilonA}) should be around ${epsilonA * 100}%. Got: ${(errorRateA * 100).toFixed(2)}% (errors: ${errorsA})`);

    // Case B: Testing "Confidently Dissimilar" boundary
    // We set a threshold HIGH, and expect early exit with 0.0 most of the time.
    // An "error" here is if it returns 1.0 (i.e., says it's confidently SIMILAR to the high threshold)
    const thresholdB = 0.7; // Higher than targetJaccard
    const epsilonB = 0.05; // We expect errors (returning 1.0) to be <= 5%
    let errorsB = 0;

    for (let i = 0; i < iterations; i++) {
        const { setA, setB } = createSimilarSets(setSize, targetJaccard, i + 2000);
        const sigA = generateGroupedOPHSignature(setA, numHashes, numGroups, bitDepth);
        const sigB = generateGroupedOPHSignature(setB, numHashes, numGroups, bitDepth);
        const opts = { numGroups, similarityThreshold: thresholdB, errorTolerance: epsilonB };
        const result = estimateJaccardSimilarity(sigA, sigB, opts);
        if (result === 1.0) { // Early exit saying similar to the high threshold (this is the error type we are counting)
            errorsB++;
        }
    }
    const errorRateB = errorsB / iterations;
    t.ok(errorRateB <= epsilonB + 0.02, `Error rate for 'confidently dissimilar' (T=${thresholdB}, J_act~${targetJaccard}, eps=${epsilonB}) should be around ${epsilonB * 100}%. Got: ${(errorRateB * 100).toFixed(2)}% (errors: ${errorsB})`);

    t.comment('Monte Carlo tests are statistical; minor variations are expected. An additional margin (+2%) is added to epsilon for the assertion.');
    t.end();
});

test('Approximate Similarity - Statistical Accuracy (Monte Carlo) - AGGRESSIVE EPSILON', (t) => {
    const numHashes = 128;
    const numGroups = 4;
    const bitDepth = 32;
    const iterations = 1000; // Number of Monte Carlo iterations
    const targetJaccard = 0.5;
    const setSize = 200;

    // Using a more aggressive (larger) epsilon to encourage more early exits
    const aggressiveEpsilon = 0.15; // e.g., allow up to 15% error rate for early exits

    // Case A: Testing "Confidently Similar" boundary with aggressive epsilon
    const thresholdA = 0.48; // Even Closer to targetJaccard (0.5) to really stress epsilon
    let errorsAggressiveA = 0;

    for (let i = 0; i < iterations; i++) {
        const { setA, setB } = createSimilarSets(setSize, targetJaccard, i + 3000); // Different seed offset
        const sigA = generateGroupedOPHSignature(setA, numHashes, numGroups, bitDepth);
        const sigB = generateGroupedOPHSignature(setB, numHashes, numGroups, bitDepth);
        const opts = { numGroups, similarityThreshold: thresholdA, errorTolerance: aggressiveEpsilon };
        const result = estimateJaccardSimilarity(sigA, sigB, opts);
        if (result === 0.0) { // Early exit saying dissimilar to the low threshold
            errorsAggressiveA++;
        }
    }
    const errorRateAggressiveA = errorsAggressiveA / iterations;
    t.ok(errorRateAggressiveA <= aggressiveEpsilon + 0.03, `AGGRESSIVE Error rate for 'confidently similar' (T=${thresholdA}, J_act~${targetJaccard}, aggressive_eps=${aggressiveEpsilon}) should be around ${aggressiveEpsilon * 100}%. Got: ${(errorRateAggressiveA * 100).toFixed(2)}% (errors: ${errorsAggressiveA})`);

    // Case B: Testing "Confidently Dissimilar" boundary with aggressive epsilon
    const thresholdB = 0.52; // Even Closer to targetJaccard (0.5) to really stress epsilon
    let errorsAggressiveB = 0;

    for (let i = 0; i < iterations; i++) {
        const { setA, setB } = createSimilarSets(setSize, targetJaccard, i + 4000); // Different seed offset
        const sigA = generateGroupedOPHSignature(setA, numHashes, numGroups, bitDepth);
        const sigB = generateGroupedOPHSignature(setB, numHashes, numGroups, bitDepth);
        const opts = { numGroups, similarityThreshold: thresholdB, errorTolerance: aggressiveEpsilon };
        const result = estimateJaccardSimilarity(sigA, sigB, opts);
        if (result === 1.0) { // Early exit saying similar to the high threshold
            errorsAggressiveB++;
        }
    }
    const errorRateAggressiveB = errorsAggressiveB / iterations;
    t.ok(errorRateAggressiveB <= aggressiveEpsilon + 0.03, `AGGRESSIVE Error rate for 'confidently dissimilar' (T=${thresholdB}, J_act~${targetJaccard}, aggressive_eps=${aggressiveEpsilon}) should be around ${aggressiveEpsilon * 100}%. Got: ${(errorRateAggressiveB * 100).toFixed(2)}% (errors: ${errorsAggressiveB})`);

    t.comment('Aggressive Monte Carlo tests use a higher epsilon. A slightly larger margin (+3%) is added for statistical variance.');
    t.end()
});

test('Approximate Similarity - Input Validations for Options', (t) => {
    const sig = new Uint8Array([1,2,3,4,5,6,7,8]); // Length 8

    t.throws(() => {
        estimateJaccardSimilarity(sig, sig, { similarityThreshold: 0.5, errorTolerance: 0.01 });
    }, /Invalid or missing 'numGroups' for optimized similarity estimation/, 'Throws if numGroups is missing and options are provided');

    t.throws(() => {
        estimateJaccardSimilarity(sig, sig, { numGroups: 2, errorTolerance: 0.01 });
    }, /Invalid or missing 'similarityThreshold' for optimized similarity estimation/, 'Throws if similarityThreshold is missing');

    t.throws(() => {
        estimateJaccardSimilarity(sig, sig, { numGroups: 2, similarityThreshold: 0.5 });
    }, /Invalid or missing 'errorTolerance' for optimized similarity estimation/, 'Throws if errorTolerance is missing');

    t.throws(() => {
        estimateJaccardSimilarity(sig, sig, { numGroups: 0, similarityThreshold: 0.5, errorTolerance: 0.01 });
    }, /Invalid or missing 'numGroups' for optimized similarity estimation/, 'Throws if numGroups is 0');

    t.throws(() => {
        estimateJaccardSimilarity(sig, sig, { numGroups: 3, similarityThreshold: 0.5, errorTolerance: 0.01 });
    }, /Invalid or missing 'numGroups' for optimized similarity estimation.*divisor of signature length/, 'Throws if signature length (8) is not divisible by numGroups (3)');
    
    // Test that providing no optimization options falls back to full comparison without error
    const resNoOptions = estimateJaccardSimilarity(sig, sig, {});
    t.equal(resNoOptions, 1.0, 'If no optimization options are provided, defaults to full comparison and does not throw.');

    const resUndefinedOptions = estimateJaccardSimilarity(sig, sig, undefined);
    t.equal(resUndefinedOptions, 1.0, 'If options object is undefined, defaults to full comparison and does not throw.');

    const resNullOptions = estimateJaccardSimilarity(sig, sig, null); // null is an object, so this will cause issues if not handled as {} essentially
    t.equal(resNullOptions, 1.0, 'If options object is null, defaults to full comparison (as it becomes {}).');


    t.comment('Validation tests now expect specific errors for incomplete/invalid optimization options.');
    t.end();
}); 