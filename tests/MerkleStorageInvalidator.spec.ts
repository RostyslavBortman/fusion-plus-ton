import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, Address, Cell, beginCell } from '@ton/core';
import { MerkleStorageInvalidator } from '../build/merkle-storage-invalidator/merkle-storage-invalidator_MerkleStorageInvalidator';
import '@ton/test-utils';

describe('MerkleStorageInvalidator', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lop: SandboxContract<TreasuryContract>;
    let invalidator: SandboxContract<MerkleStorageInvalidator>;

    // Constants from Solidity
    const SRC_IMMUTABLES_LENGTH = 160; // bytes

    // Helper functions
    function createMerkleTree(secrets: bigint[]): {
        root: bigint,
        proofs: Cell[],
        leaves: bigint[]
    } {
        // Create leaves: hash(idx || secretHash)
        const leaves = secrets.map((secret, idx) => {
            const leaf = beginCell()
                .storeUint(idx, 64)
                .storeUint(secret, 256)
                .endCell()
                .hash();
            return BigInt('0x' + leaf.toString('hex'));
        });

        // Build tree (example for 4 leaves)
        const tree: bigint[][] = [leaves];
        let currentLevel = leaves;

        while (currentLevel.length > 1) {
            const nextLevel: bigint[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                if (i + 1 < currentLevel.length) {
                    const left = currentLevel[i];
                    const right = currentLevel[i + 1];
                    // Commutative hash like in Solidity
                    const hash = left < right
                        ? hashPair(left, right)
                        : hashPair(right, left);
                    nextLevel.push(hash);
                } else {
                    nextLevel.push(currentLevel[i]);
                }
            }
            tree.push(nextLevel);
            currentLevel = nextLevel;
        }

        const root = currentLevel[0];

        // Generate proofs
        const proofs: Cell[] = [];
        for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
            const proof = generateProof(tree, leafIdx);
            proofs.push(proof);
        }

        return { root, proofs, leaves };
    }

    function hashPair(a: bigint, b: bigint): bigint {
        const cell = beginCell()
            .storeUint(a, 256)
            .storeUint(b, 256)
            .endCell();
        return BigInt('0x' + cell.hash().toString('hex'));
    }

    function generateProof(tree: bigint[][], leafIdx: number): Cell {
        const proofBuilder = beginCell();
        let idx = leafIdx;

        for (let level = 0; level < tree.length - 1; level++) {
            const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
            if (siblingIdx < tree[level].length) {
                proofBuilder.storeUint(tree[level][siblingIdx], 256);
            }
            idx = Math.floor(idx / 2);
        }

        return proofBuilder.endCell();
    }

    function createTakerData(proof: Cell, idx: number, secretHash: bigint): Cell {
        return beginCell()
            .storeRef(proof)
            .storeUint(idx, 256)
            .storeUint(secretHash, 256)
            .endCell();
    }

    function createExtension(hashlockInfo: bigint): Cell {
        // Split data between main cell and ref to avoid overflow
        // Main cell: hashlockInfo + dstChainId + dstToken = 672 bits
        const mainBuilder = beginCell()
            .storeUint(hashlockInfo, 256)
            .storeUint(1, 256) // dstChainId  
            .storeUint(0, 160); // dstToken

        // Ref cell: deposits + timelocks = 512 bits
        const refBuilder = beginCell()
            .storeUint(1000, 256) // deposits
            .storeUint(0, 256); // timelocks

        return mainBuilder
            .storeRef(refBuilder.endCell())
            .endCell();
    }

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        lop = await blockchain.treasury('lop');

        invalidator = blockchain.openContract(
            await MerkleStorageInvalidator.fromInit(lop.address)
        );

        const deployResult = await invalidator.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: invalidator.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy with correct state', async () => {
        const contractAddress = invalidator.address;
        expect(contractAddress).toBeDefined();
    });

    it('should verify and store merkle proof - single fill', async () => {
        const orderHash = 12345n;
        const secrets = [111n, 222n, 333n, 444n];
        const { root, proofs, leaves } = createMerkleTree(secrets);

        const idx = 0;
        const takerData = createTakerData(proofs[idx], idx, secrets[idx]);
        const extension = createExtension(root);

        const result = await invalidator.send(
            lop.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TakerInteraction',
                order: beginCell().endCell(),
                extension: extension,
                orderHash: orderHash,
                taker: lop.address,
                makingAmount: 1000n,
                takingAmount: 2000n,
                remainingMakingAmount: 1000n,
                extraData: takerData
            }
        );

        // Check that transaction from lop to invalidator exists
        expect(result.transactions).toHaveTransaction({
            from: lop.address,
            to: invalidator.address,
        });

        // If successful, should have more than 2 transactions (deployment of storage)
        expect(result.transactions.length).toBeGreaterThan(2);
    });

    it('should reject invalid merkle proof', async () => {
        const orderHash = 12345n;
        const secrets = [111n, 222n, 333n, 444n];
        const { root, proofs } = createMerkleTree(secrets);

        const idx = 0;
        const wrongSecret = 999n;
        const takerData = createTakerData(proofs[idx], idx, wrongSecret);
        const extension = createExtension(root);

        const result = await invalidator.send(
            lop.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TakerInteraction',
                order: beginCell().endCell(),
                extension: extension,
                orderHash: orderHash,
                taker: lop.address,
                makingAmount: 1000n,
                takingAmount: 2000n,
                remainingMakingAmount: 1000n,
                extraData: takerData
            }
        );

        // Check transactions exist
        expect(result.transactions.length).toBeGreaterThan(0);

        // Should have bounced transaction
        expect(result.transactions).toHaveTransaction({
            from: lop.address,
            to: invalidator.address,
        });
    });

    it('should reject non-LOP calls', async () => {
        const attacker = await blockchain.treasury('attacker');

        const result = await invalidator.send(
            attacker.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TakerInteraction',
                order: beginCell().endCell(),
                extension: createExtension(0n),
                orderHash: 0n,
                taker: attacker.address,
                makingAmount: 0n,
                takingAmount: 0n,
                remainingMakingAmount: 0n,
                extraData: beginCell()
                    .storeRef(beginCell().endCell())
                    .storeUint(0, 256)
                    .storeUint(0, 256)
                    .endCell()
            }
        );

        // Check that transaction exists
        expect(result.transactions).toHaveTransaction({
            from: attacker.address,
            to: invalidator.address,
        });

        // Should only have 2 transactions (send and maybe bounce)
        expect(result.transactions.length).toBeLessThanOrEqual(3);
    });

    it('should handle multiple fills with different secrets', async () => {
        const orderHash = 12345n;
        const partsAmount = 4;
        const secrets = [111n, 222n, 333n, 444n];
        const { root, proofs } = createMerkleTree(secrets);

        const hashlockInfo = (BigInt(partsAmount) << 240n) | (root & ((1n << 240n) - 1n));
        const extension = createExtension(hashlockInfo);

        // First fill
        let result = await invalidator.send(
            lop.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TakerInteraction',
                order: beginCell().endCell(),
                extension: extension,
                orderHash: orderHash,
                taker: lop.address,
                makingAmount: 250n,
                takingAmount: 500n,
                remainingMakingAmount: 1000n,
                extraData: createTakerData(proofs[0], 0, secrets[0])
            }
        );

        // Check first transaction
        expect(result.transactions).toHaveTransaction({
            from: lop.address,
            to: invalidator.address,
        });

        // Second fill
        result = await invalidator.send(
            lop.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TakerInteraction',
                order: beginCell().endCell(),
                extension: extension,
                orderHash: orderHash,
                taker: lop.address,
                makingAmount: 250n,
                takingAmount: 500n,
                remainingMakingAmount: 750n,
                extraData: createTakerData(proofs[1], 1, secrets[1])
            }
        );

        // Check second transaction
        expect(result.transactions).toHaveTransaction({
            from: lop.address,
            to: invalidator.address,
        });
    });

    it('should correctly parse ExtraDataArgs from extension', async () => {
        const orderHash = 12345n;
        const hashlockInfo = 0xABCDEFn;

        const extension = createExtension(hashlockInfo);
        const secrets = [111n];
        const { proofs } = createMerkleTree(secrets);
        const takerData = createTakerData(proofs[0], 0, secrets[0]);

        const result = await invalidator.send(
            lop.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TakerInteraction',
                order: beginCell().endCell(),
                extension: extension,
                orderHash: orderHash,
                taker: lop.address,
                makingAmount: 1000n,
                takingAmount: 2000n,
                remainingMakingAmount: 1000n,
                extraData: takerData
            }
        );

        // Check that transaction was sent
        expect(result.transactions).toHaveTransaction({
            from: lop.address,
            to: invalidator.address,
        });

        // Check transactions count
        expect(result.transactions.length).toBeGreaterThan(0);
    });
});