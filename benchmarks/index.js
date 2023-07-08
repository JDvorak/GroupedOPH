import { murmurhash3_32_gc, generateGroupedOPHSignature, estimateJaccardSimilarity, downgradeSignature, getBitDepth } from '../index.js'; // Import necessary functions including getBitDepth
import crypto from 'crypto';

const NUM_SETS = 50000; // Increased sample size
const SET_SIZE = 50; // Average number of elements (hashes) per set
const NUM_HASHES_SIG = 128; // Signature length for GOPH
const NUM_GROUPS_SIG = 4; // Number of groups for GOPH
const HASH_LENGTH = 40; // Length of simulated base strings
const SEED = 12345; // Seed for murmurhash

const NUM_ESTIMATION_RUNS = 100000; // How many times to run estimation
const ESTIMATION_SIMILARITY = 0.5; // Target similarity for generated sets

console.log(`Benchmarking generateGroupedOPHSignature with ${NUM_SETS} sets (avg size ${SET_SIZE}), signature size ${NUM_HASHES_SIG}, groups ${NUM_GROUPS_SIG}...\n`);

// --- Generate Sample Element Hash Sets ---
const sampleSets = [];
console.time('Generate Sample Sets');
for (let i = 0; i < NUM_SETS; i++) {
  const currentSet = new Set();
  // Generate base string for the set
  const baseString = crypto.randomBytes(HASH_LENGTH / 2).toString('hex');
  for (let j = 0; j < SET_SIZE; j++) {
    // Create variations (like shingles) and hash them
    const variation = baseString.substring(j % (HASH_LENGTH - 2), (j % (HASH_LENGTH - 2)) + 3);
    currentSet.add(murmurhash3_32_gc(variation, SEED)); // Use murmurhash to simulate element hashes
  }
  sampleSets.push(currentSet);
}
console.timeEnd('Generate Sample Sets');
console.log(`Generated ${sampleSets.length} sample sets.`);

// --- Benchmark generateGroupedOPHSignature --- 
let signaturesGenerated = 0;
console.time('generateGroupedOPHSignature Benchmark');

for (const elementSet of sampleSets) {
  try {
    const signature = generateGroupedOPHSignature(elementSet, NUM_HASHES_SIG, NUM_GROUPS_SIG);
    // Optional: Add a simple check
    if (signature.length !== NUM_HASHES_SIG) {
      console.error('Unexpected signature length!');
    }
    signaturesGenerated++;
  } catch (error) {
    console.error('Error generating signature:', error);
  }
}

console.timeEnd('generateGroupedOPHSignature Benchmark');
console.log(`Successfully generated ${signaturesGenerated} signatures.`);

let startTimeGen = Date.now();
signaturesGenerated = 0;
for (const elementSet of sampleSets) {
    generateGroupedOPHSignature(elementSet, NUM_HASHES_SIG, NUM_GROUPS_SIG);
    signaturesGenerated++;
}
let endTimeGen = Date.now();
let durationMsGen = endTimeGen - startTimeGen;
if (durationMsGen > 0) {
    const opsPerSecond = (signaturesGenerated / durationMsGen) * 1000;
    console.log(`Performance (Sig Gen): Approximately ${opsPerSecond.toFixed(2)} signatures/second.`);
} else {
    console.log('Sig Gen benchmark finished too quickly.');
}

console.log(`\n--- Benchmarking estimateJaccardSimilarity ---`);
console.log(`Config: ${NUM_ESTIMATION_RUNS} estimations, signature size ${NUM_HASHES_SIG}...\n`);

// --- Generate two signatures for similarity estimation ---
console.time('Generate Signatures for Estimation');
// Helper to create sets with target similarity (simplified from HCSMinHash)
function createSimilarSetsForBench(targetSize, targetSimilarity) {
    const setA = new Set();
    const setB = new Set();
    const intersectionSize = Math.round(targetSize * targetSimilarity);
    const uniqueSize = targetSize - intersectionSize;
    let added = 0;
    const MAX_VAL = 2**31;
    // Intersection
    while (added < intersectionSize) {
        const item = Math.floor(Math.random() * MAX_VAL);
        if (!setA.has(item)) { setA.add(item); setB.add(item); added++; }
    }
    // Unique A
    added = 0;
    while (added < uniqueSize) {
        const item = Math.floor(Math.random() * MAX_VAL);
        if (!setA.has(item)) { setA.add(item); added++; }
    }
    // Unique B
    added = 0;
    while (added < uniqueSize) {
        const item = Math.floor(Math.random() * MAX_VAL);
        if (!setB.has(item)) { setB.add(item); added++; }
    }
    return { setA, setB };
}
const { setA, setB } = createSimilarSetsForBench(SET_SIZE * 2, ESTIMATION_SIMILARITY); // Use larger sets for stable signatures
const sigA = generateGroupedOPHSignature(setA, NUM_HASHES_SIG, NUM_GROUPS_SIG);
const sigB = generateGroupedOPHSignature(setB, NUM_HASHES_SIG, NUM_GROUPS_SIG);
console.timeEnd('Generate Signatures for Estimation');
console.log(`Generated two signatures for estimation (Similarity ≈ ${ESTIMATION_SIMILARITY}).`);

// --- Benchmark estimateJaccardSimilarity ---
let estimationsRun = 0;
console.time('estimateJaccardSimilarity Benchmark');
for (let i = 0; i < NUM_ESTIMATION_RUNS; i++) {
    try {
        const similarity = estimateJaccardSimilarity(sigA, sigB);
        if (typeof similarity !== 'number') console.error('Unexpected similarity type!');
        estimationsRun++;
    } catch (error) {
        console.error('Error estimating similarity:', error);
    }
}
console.timeEnd('estimateJaccardSimilarity Benchmark');
console.log(`Successfully ran ${estimationsRun} estimations.`);

let startTimeEst = Date.now();
estimationsRun = 0;
for (let i = 0; i < NUM_ESTIMATION_RUNS; i++) {
    estimateJaccardSimilarity(sigA, sigB);
    estimationsRun++;
}
let endTimeEst = Date.now();
let durationMsEst = endTimeEst - startTimeEst;
if (durationMsEst > 0) {
    const opsPerSecond = (estimationsRun / durationMsEst) * 1000;
    console.log(`Performance (Estimation): Approximately ${opsPerSecond.toFixed(2)} estimations/second.`);
} else {
    console.log('Estimation benchmark finished too quickly.');
}

console.log(`\n--- Benchmarking estimateJaccardSimilarity Speed vs. Bit Depth ---`);
const bitDepthsToTest = [32, 16, 8, 4, 2];
const { setA: setForBitDepthTest, setB: setBForBitDepthTest } = createSimilarSetsForBench(SET_SIZE * 2, ESTIMATION_SIMILARITY);

for (const bitDepth of bitDepthsToTest) {
    console.log(`\nBenchmarking for ${bitDepth}-bit signatures...`);
    let sigA_bd, sigB_bd;
    try {
        console.time(`Generate Signatures for ${bitDepth}-bit`);
        sigA_bd = generateGroupedOPHSignature(setForBitDepthTest, NUM_HASHES_SIG, NUM_GROUPS_SIG, bitDepth);
        sigB_bd = generateGroupedOPHSignature(setBForBitDepthTest, NUM_HASHES_SIG, NUM_GROUPS_SIG, bitDepth);
        console.timeEnd(`Generate Signatures for ${bitDepth}-bit`);
    } catch (e) {
        console.error(`Error generating signatures for ${bitDepth}-bit: ${e.message}`);
        continue;
    }

    let estimationsRunBd = 0;
    console.time(`estimateJaccardSimilarity ${bitDepth}-bit Benchmark`);
    for (let i = 0; i < NUM_ESTIMATION_RUNS; i++) {
        try {
            const similarity = estimateJaccardSimilarity(sigA_bd, sigB_bd);
            if (typeof similarity !== 'number') console.error('Unexpected similarity type!');
            estimationsRunBd++;
        } catch (error) {
            console.error(`Error estimating similarity for ${bitDepth}-bit:`, error);
            // Potentially break or continue based on error handling preference for benchmarks
            break; 
        }
    }
    console.timeEnd(`estimateJaccardSimilarity ${bitDepth}-bit Benchmark`);
    
    // Manual timing for ops/sec as console.time/End doesn't return duration directly for easy calculation here
    const startTimeBdEst = Date.now();
    estimationsRunBd = 0; // Reset for manual timing loop
    for (let i = 0; i < NUM_ESTIMATION_RUNS; i++) {
        estimateJaccardSimilarity(sigA_bd, sigB_bd);
        estimationsRunBd++;
    }
    const endTimeBdEst = Date.now();
    const durationMsBdEst = endTimeBdEst - startTimeBdEst;

    if (durationMsBdEst > 0) {
        const opsPerSecondBd = (estimationsRunBd / durationMsBdEst) * 1000;
        console.log(`Performance (${bitDepth}-bit Estimation): Approximately ${opsPerSecondBd.toFixed(2)} estimations/second.`);
    } else {
        console.log(`(${bitDepth}-bit Estimation) benchmark finished too quickly.`);
    }
}

console.log(`\n--- Benchmarking downgradeSignature Speed ---`);
const highPrecisionSigForDowngradeTest = generateGroupedOPHSignature(setForBitDepthTest, NUM_HASHES_SIG, NUM_GROUPS_SIG, 32);
const downgradeTargets = [16, 8, 4, 2]; // Bit depths to downgrade to from 32-bit
const NUM_DOWNGRADE_RUNS = NUM_ESTIMATION_RUNS; // Reuse for comparable number of operations

for (const targetBitDepth of downgradeTargets) {
    console.log(`\nBenchmarking downgrade from 32-bit to ${targetBitDepth}-bit...`);
    
    let downgradesRun = 0;
    // Manual timing for ops/sec
    const startTimeDowngrade = Date.now();
    for (let i = 0; i < NUM_DOWNGRADE_RUNS; i++) {
        try {
            const downgradedSig = downgradeSignature(highPrecisionSigForDowngradeTest, targetBitDepth);
            // Optional: Add a simple check for the result
            if (!downgradedSig || getBitDepth(downgradedSig) === null ) { // Basic check, getBitDepth for Uint8Array will be 8
                 // For 4-bit and 2-bit, it's still Uint8Array, so getBitDepth will be 8.
                 // A more accurate check would be to verify values are within targetBitDepth range if needed.
            }
            downgradesRun++;
        } catch (error) {
            console.error(`Error downgrading to ${targetBitDepth}-bit:`, error);
            break; 
        }
    }
    const endTimeDowngrade = Date.now();
    const durationMsDowngrade = endTimeDowngrade - startTimeDowngrade;

    if (durationMsDowngrade > 0) {
        const opsPerSecondDowngrade = (downgradesRun / durationMsDowngrade) * 1000;
        console.log(`Performance (Downgrade 32-bit to ${targetBitDepth}-bit): Approximately ${opsPerSecondDowngrade.toFixed(2)} downgrades/second.`);
    } else {
        console.log(`(Downgrade 32-bit to ${targetBitDepth}-bit) benchmark finished too quickly.`);
    }
}
