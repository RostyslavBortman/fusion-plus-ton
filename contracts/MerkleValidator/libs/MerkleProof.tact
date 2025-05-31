// Merkle proof verification library
inline fun verifyMerkleProof(proof: Cell, leaf: Int, expectedRoot: Int): Bool {
    let currentHash = leaf;
    let proofSlice = proof.beginParse();
    // Process each proof element
    while (proofSlice.bits() >= 256) {
        let proofElement = proofSlice.loadUint(256);
        // Hash pair in sorted order (smaller first)
        if (currentHash < proofElement) {
            currentHash = beginCell().storeUint(currentHash, 256).storeUint(proofElement, 256).endCell().hash();
        } else {
            currentHash = beginCell().storeUint(proofElement, 256).storeUint(currentHash, 256).endCell().hash();
        }
    }
    // Compare only lower 240 bits since expectedRoot is rootShortened
    return (currentHash & ((1 << 240) - 1)) == expectedRoot;
}

// Create leaf hash from index and secret hash

inline fun createLeafHash(idx: Int, secretHash: Int): Int {
    return beginCell().storeUint(idx, 64).storeUint(secretHash, 256).endCell().hash();
}

// Alternative: process proof from slice with refs

inline fun verifyMerkleProofWithRefs(proofSlice: Slice, leaf: Int, expectedRoot: Int): Bool {
    let currentHash = leaf;
    // Process inline elements
    while (proofSlice.bits() >= 256) {
        let proofElement = proofSlice.loadUint(256);
        currentHash = hashPair(currentHash, proofElement);
    }
    // Process referenced elements
    while (proofSlice.refs() > 0) {
        let refCell = proofSlice.loadRef();
        let refSlice = refCell.beginParse();
        while (refSlice.bits() >= 256) {
            let proofElement = refSlice.loadUint(256);
            currentHash = hashPair(currentHash, proofElement);
        }
    }
    return currentHash == expectedRoot;
}

// Helper to hash two values in sorted order

inline fun hashPair(a: Int, b: Int): Int {
    if (a < b) {
        return beginCell().storeUint(a, 256).storeUint(b, 256).endCell().hash();
    } else {
        return beginCell().storeUint(b, 256).storeUint(a, 256).endCell().hash();
    }
}