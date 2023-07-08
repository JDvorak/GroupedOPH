import tape from 'tape';
import {
    generateGroupedOPHSignature,
    estimateJaccardSimilarity,
    downgradeSignature,
    getBitDepth,
    murmurhash3_32_gc,
    murmurhash3_32_gc_single_int,
    hashStringFNV1a
} from '../index.js';

const test = tape;

test('generateGroupedOPHSignature - Basic Functionality', (t) => {
    const elementHashes = new Set([1, 2, 3, 4, 5]);
    const numHashes = 128;
    const numGroups = 4;

    t.doesNotThrow(() => {
        generateGroupedOPHSignature(elementHashes, numHashes, numGroups);
    }, 'Should not throw with valid inputs (default 32-bit)');

    const sig32 = generateGroupedOPHSignature(elementHashes, numHashes, numGroups);
    t.equal(sig32.length, numHashes, 'Signature length should match numHashes (32-bit)');
    t.ok(sig32 instanceof Uint32Array, 'Should return Uint32Array for default bit depth');
    sig32.forEach(val => {
        t.ok(val >= 0 && val <= 0xFFFFFFFF, '32-bit signature values should be in Uint32 range');
    });

    const sig16 = generateGroupedOPHSignature(elementHashes, numHashes, numGroups, 16);
    t.equal(sig16.length, numHashes, 'Signature length should match numHashes (16-bit)');
    t.ok(sig16 instanceof Uint16Array, 'Should return Uint16Array for 16-bit depth');
    sig16.forEach(val => {
        t.ok(val >= 0 && val <= 0xFFFF, '16-bit signature values should be in Uint16 range');
    });

    const sig8 = generateGroupedOPHSignature(elementHashes, numHashes, numGroups, 8);
    t.equal(sig8.length, numHashes, 'Signature length should match numHashes (8-bit)');
    t.ok(sig8 instanceof Uint8Array, 'Should return Uint8Array for 8-bit depth');
    sig8.forEach(val => {
        t.ok(val >= 0 && val <= 0xFF, '8-bit signature values should be in Uint8 range');
    });

    const sig4 = generateGroupedOPHSignature(elementHashes, numHashes, numGroups, 4);
    t.equal(sig4.length, numHashes, 'Signature length should match numHashes (4-bit)');
    t.ok(sig4 instanceof Uint8Array, 'Should return Uint8Array for 4-bit depth (stored in Uint8)');
    sig4.forEach(val => {
        t.ok(val >= 0 && val <= 0x0F, '4-bit signature values should be in 0-15 range');
    });

    const sig2 = generateGroupedOPHSignature(elementHashes, numHashes, numGroups, 2);
    t.equal(sig2.length, numHashes, 'Signature length should match numHashes (2-bit)');
    t.ok(sig2 instanceof Uint8Array, 'Should return Uint8Array for 2-bit depth (stored in Uint8)');
    sig2.forEach(val => {
        t.ok(val >= 0 && val <= 0x03, '2-bit signature values should be in 0-3 range');
    });
    
    t.end();
});

test('generateGroupedOPHSignature - Input Validations', (t) => {
    const elementHashes = new Set([1, 2, 3]);

    t.throws(() => {
        generateGroupedOPHSignature(elementHashes, 128, 5); // numHashes not divisible by numGroups
    }, /numHashes must be divisible by numGroups/, 'Throws if numHashes not divisible by numGroups');

    t.throws(() => {
        generateGroupedOPHSignature(elementHashes, 0, 4); // numHashes not positive
    }, /numHashes must be a positive integer/, 'Throws if numHashes is not positive');

    t.throws(() => {
        generateGroupedOPHSignature(elementHashes, 128, 0); // numGroups not positive
    }, /numGroups must be a positive integer/, 'Throws if numGroups is not positive');

    t.throws(() => {
        generateGroupedOPHSignature(elementHashes, 128, 4, 7); // invalid bitDepth
    }, /bitDepth must be 2, 4, 8, 16, or 32/, 'Throws for invalid bitDepth');

    t.doesNotThrow(() => {
        generateGroupedOPHSignature(new Set(), 128, 4);
    }, 'Should not throw for empty elementHashSet');

    const emptySig = generateGroupedOPHSignature(new Set(), 128, 4);
    t.equal(emptySig.length, 128, 'Signature for empty set should still have correct length');
    emptySig.forEach(val => {
        t.equal(val, 0, 'Values in signature for empty set should be 0 (after fillVal replacement)');
    });

    t.end();
});

test('estimateJaccardSimilarity - Functionality and Edge Cases', (t) => {
    const sigSize = 8; // Using a small signature size for easy manual verification
    const groups = 2;

    // Case 1: Identical signatures
    const set1 = new Set([1, 2, 3, 4]);
    const sig1A = generateGroupedOPHSignature(set1, sigSize, groups, 8);
    const sig1B = generateGroupedOPHSignature(set1, sigSize, groups, 8);
    // Due to the nature of MinHash, even for identical sets, signatures might not be byte-for-byte identical
    // if multiple elements hash to the same minimum slot. However, estimateJaccard should be 1.0.
    // For a deterministic test of estimateJaccard itself, we directly provide identical arrays:
    const identicalSig = new Uint8Array([1,2,3,4,5,6,7,8]);
    t.equal(estimateJaccardSimilarity(identicalSig, identicalSig), 1.0, 'Identical non-empty signatures -> 1.0');

    // Case 2: Completely different signatures
    const diffSigA = new Uint8Array([1, 2, 3, 4]);
    const diffSigB = new Uint8Array([5, 6, 7, 8]);
    t.equal(estimateJaccardSimilarity(diffSigA, diffSigB), 0.0, 'Completely different non-empty signatures -> 0.0');

    // Case 3: Partially overlapping signatures
    // sigA = [10, 20, 30, 40]
    // sigB = [10, 20, 50, 60]
    // Matches = 2 (10, 20). Union based on non-zero = 4 positions (all)
    // Expected: 2 / 4 = 0.5
    const partialA = new Uint8Array([10, 20, 30, 40]);
    const partialB = new Uint8Array([10, 20, 50, 60]);
    t.equal(estimateJaccardSimilarity(partialA, partialB), 0.5, 'Partially overlapping signatures (0.5)');
    
    // sigC = [10, 0, 30, 0]
    // sigD = [10, 25, 0, 0]
    // Matches = 1 (10). Non-zero slots in C: (10, 30). Non-zero in D: (10, 25).
    // Union of positions with non-zero values: pos 0 (10,10), pos 1 (0,25), pos 2 (30,0)
    // Union count = 3. Expected: 1 / 3
    const partialC = new Uint8Array([10,  0, 30,  0]);
    const partialD = new Uint8Array([10, 25,  0,  0]);
    t.equal(estimateJaccardSimilarity(partialC, partialD), 1/3, 'Partially overlapping with zeros (1/3)');

    // Case 4: Signatures with all zeros (empty sets)
    const zerosA = new Uint8Array([0, 0, 0, 0]);
    const zerosB = new Uint8Array([0, 0, 0, 0]);
    t.equal(estimateJaccardSimilarity(zerosA, zerosB), 1.0, 'Signatures of all zeros (empty sets) -> 1.0');

    // Case 5: One signature all zeros, other not
    // sigE = [0,0,0,0]
    // sigF = [1,2,0,0]
    // Matches = 0. Union count = 2 (pos 0, pos 1). Expected: 0 / 2 = 0.0
    const zerosE = new Uint8Array([0,0,0,0]);
    const mixF = new Uint8Array([1,2,0,0]);
    t.equal(estimateJaccardSimilarity(zerosE, mixF), 0.0, 'One all zeros, one mixed -> 0.0');

    // Case 6: Empty signatures (length 0 array)
    const emptyArrA = new Uint8Array([]);
    const emptyArrB = new Uint8Array([]);
    t.equal(estimateJaccardSimilarity(emptyArrA, emptyArrB), 1.0, 'Empty array signatures (length 0) -> 1.0');

    // Case 7: Input validation - mismatched lengths
    t.throws(() => {
        estimateJaccardSimilarity(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]));
    }, /Signatures must be non-null and of equal length/, 'Throws for mismatched signature lengths');

    // Case 8: Input validation - null signatures
    t.throws(() => {
        estimateJaccardSimilarity(null, new Uint8Array([1, 2, 3]));
    }, /Signatures must be non-null and of equal length/, 'Throws for null signature A');
    t.throws(() => {
        estimateJaccardSimilarity(new Uint8Array([1, 2, 3]), null);
    }, /Signatures must be non-null and of equal length/, 'Throws for null signature B');

    t.end();
});

test('getBitDepth - Functionality', (t) => {
    t.equal(getBitDepth(new Uint32Array(4)), 32, 'Uint32Array should report 32');
    t.equal(getBitDepth(new Uint16Array(4)), 16, 'Uint16Array should report 16');
    t.equal(getBitDepth(new Uint8Array(4)), 8, 'Uint8Array should report 8');
    
    t.equal(getBitDepth(new Int32Array(4)), null, 'Int32Array should report null (unsupported)');
    t.equal(getBitDepth([1, 2, 3]), null, 'Standard array should report null');
    t.equal(getBitDepth(null), null, 'null input should report null');
    t.equal(getBitDepth(undefined), null, 'undefined input should report null');
    t.equal(getBitDepth({}), null, 'Object input should report null');

    t.end();
});

test('downgradeSignature - Functionality and Validations', (t) => {
    const numHashes = 8;
    const numGroups = 2;
    const elements = new Set([100, 200, 30000, 40000, 60000, 700000]);

    // Generate a 32-bit signature to start with
    // Values can be large, e.g., [ AAAAAAAA, BBBBBBBB, CCCCCCCC, DDDDDDDD, ... ]
    const sig32 = generateGroupedOPHSignature(elements, numHashes, numGroups, 32);
    t.ok(sig32 instanceof Uint32Array, 'Original signature is Uint32Array');

    // Downgrade to 16-bit
    // Expected: values like [ AAAA, BBBB, CCCC, DDDD, ... ] (masked to 0xFFFF)
    const sig16 = downgradeSignature(sig32, 16);
    t.ok(sig16 instanceof Uint16Array, 'Downgraded to 16-bit should be Uint16Array');
    t.equal(sig16.length, numHashes, '16-bit downgraded signature length correct');
    sig16.forEach((val, i) => {
        const expected = sig32[i] & 0xFFFF;
        t.equal(val, expected === 0 && sig32[i] !== 0 ? 1 : expected, '16-bit value correctly masked (or 1 if mask makes it 0 from non-zero)');
    });

    // Downgrade to 8-bit from 32-bit
    // Expected: values like [ AA, BB, CC, DD, ... ] (masked to 0xFF)
    const sig8 = downgradeSignature(sig32, 8);
    t.ok(sig8 instanceof Uint8Array, 'Downgraded to 8-bit should be Uint8Array');
    t.equal(sig8.length, numHashes, '8-bit downgraded signature length correct');
    sig8.forEach((val, i) => {
        const expected = sig32[i] & 0xFF;
        t.equal(val, expected === 0 && sig32[i] !== 0 ? 1 : expected, '8-bit value correctly masked (or 1)');
    });

    // Downgrade to 4-bit from 16-bit
    const sig16_2 = generateGroupedOPHSignature(elements, numHashes, numGroups, 16);
    const sig4 = downgradeSignature(sig16_2, 4);
    t.ok(sig4 instanceof Uint8Array, 'Downgraded to 4-bit should be Uint8Array');
    t.equal(sig4.length, numHashes, '4-bit downgraded signature length correct');
    sig4.forEach((val, i) => {
        const expected = sig16_2[i] & 0x0F;
        t.ok(val >=0 && val <= 0x0F, '4-bit value in 0-15 range')
        t.equal(val, expected === 0 && sig16_2[i] !== 0 ? 1 : expected, '4-bit value correctly masked (or 1)');
    });

    // Downgrade to 2-bit from 8-bit
    const sig8_2 = generateGroupedOPHSignature(elements, numHashes, numGroups, 8);
    const sig2 = downgradeSignature(sig8_2, 2);
    t.ok(sig2 instanceof Uint8Array, 'Downgraded to 2-bit should be Uint8Array');
    t.equal(sig2.length, numHashes, '2-bit downgraded signature length correct');
    sig2.forEach((val, i) => {
        const expected = sig8_2[i] & 0x03;
        t.ok(val >=0 && val <= 0x03, '2-bit value in 0-3 range')
        t.equal(val, expected === 0 && sig8_2[i] !== 0 ? 1 : expected, '2-bit value correctly masked (or 1)');
    });
    
    // Test fill value handling (original fill value should become 0)
    const fillSig = new Uint32Array(numHashes);
    generateGroupedOPHSignature(new Set(), numHashes, numGroups, 32).forEach((v,idx) => fillSig[idx] = v); // All 0s
    const downgradedFill = downgradeSignature(fillSig, 8);
    downgradedFill.forEach(val => {
        t.equal(val, 0, 'Downgraded signature from all zeros should be all zeros');
    });

    // Validation tests
    t.throws(() => {
        downgradeSignature(sig32, 32); // Target not lower
    }, /Target bit depth must be lower than current bit depth/, 'Throws if target bit depth is not lower');

    t.throws(() => {
        downgradeSignature(sig32, 15); // Invalid target bit depth
    }, /Target bit depth must be 2, 4, 8, or 16/, 'Throws for invalid target bit depth');

    t.throws(() => {
        downgradeSignature(new Int16Array(numHashes), 8); // Invalid source type
    }, /Invalid or unsupported signature type for downgrade/, 'Throws for invalid source signature type');

    t.end();
});

test('Hashing Utilities - Basic Sanity Checks', (t) => {
    // murmurhash3_32_gc (string input)
    const str1 = "hello world";
    const str2 = "hello World"; // Different case
    const str3 = "hello world "; // Different content

    const hash_s1_seed0 = murmurhash3_32_gc(str1, 0);
    const hash_s1_seed1 = murmurhash3_32_gc(str1, 1);
    const hash_s2_seed0 = murmurhash3_32_gc(str2, 0);
    const hash_s3_seed0 = murmurhash3_32_gc(str3, 0);

    t.ok(typeof hash_s1_seed0 === 'number' && hash_s1_seed0 >= 0, 'murmurhash3_32_gc returns a non-negative number');
    t.equal(murmurhash3_32_gc(str1, 0), hash_s1_seed0, 'murmurhash3_32_gc is deterministic for same string/seed');
    t.notEqual(hash_s1_seed0, hash_s1_seed1, 'murmurhash3_32_gc differs for same string, different seed');
    t.notEqual(hash_s1_seed0, hash_s2_seed0, 'murmurhash3_32_gc differs for different strings (case)');
    t.notEqual(hash_s1_seed0, hash_s3_seed0, 'murmurhash3_32_gc differs for different strings (content)');
    t.equal(murmurhash3_32_gc("", 0), murmurhash3_32_gc("", 0), 'murmurhash3_32_gc handles empty string');

    // murmurhash3_32_gc_single_int (integer input)
    const int1 = 123456789;
    const int2 = 987654321;

    const hash_i1_seed0 = murmurhash3_32_gc_single_int(int1, 0);
    const hash_i1_seed1 = murmurhash3_32_gc_single_int(int1, 1);
    const hash_i2_seed0 = murmurhash3_32_gc_single_int(int2, 0);

    t.ok(typeof hash_i1_seed0 === 'number' && hash_i1_seed0 >= 0, 'murmurhash3_32_gc_single_int returns a non-negative number');
    t.equal(murmurhash3_32_gc_single_int(int1, 0), hash_i1_seed0, 'murmurhash3_32_gc_single_int is deterministic for same int/seed');
    t.notEqual(hash_i1_seed0, hash_i1_seed1, 'murmurhash3_32_gc_single_int differs for same int, different seed');
    t.notEqual(hash_i1_seed0, hash_i2_seed0, 'murmurhash3_32_gc_single_int differs for different ints');
    t.equal(murmurhash3_32_gc_single_int(0, 0), murmurhash3_32_gc_single_int(0, 0), 'murmurhash3_32_gc_single_int handles 0 input');

    // hashStringFNV1a (string input)
    const fnv_s1 = hashStringFNV1a(str1);
    const fnv_s2 = hashStringFNV1a(str2);
    const fnv_s3 = hashStringFNV1a(str3);

    t.ok(typeof fnv_s1 === 'number' && fnv_s1 >= 0, 'hashStringFNV1a returns a non-negative number');
    t.equal(hashStringFNV1a(str1), fnv_s1, 'hashStringFNV1a is deterministic');
    t.notEqual(fnv_s1, fnv_s2, 'hashStringFNV1a differs for different strings (case)');
    t.notEqual(fnv_s1, fnv_s3, 'hashStringFNV1a differs for different strings (content)');
    t.equal(hashStringFNV1a(""), hashStringFNV1a(""), 'hashStringFNV1a handles empty string');

    t.end();
}); 