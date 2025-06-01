import { Blockchain, SandboxContract, TreasuryContract, BlockchainTransaction } from '@ton/sandbox';
import { Address, beginCell, toNano } from '@ton/core';
import { createHash } from 'crypto';

import { EscrowFactory } from '../build/escrow-factory/escrow-factory_EscrowFactory';
import { EscrowSrc } from '../build/escrow-src/escrow-src_EscrowSrc';
import { EscrowDst } from '../build/escrow-dst/escrow-dst_EscrowDst';
import { FeeBank } from '../build/fee-bank/fee-bank_FeeBank';
import { LimitOrderProtocol } from '../build/lop/lop_LimitOrderProtocol';
import '@ton/test-utils';


const slice = (a: Address) => beginCell().storeAddress(a).endCell().asSlice();
const empty = beginCell().endCell().asSlice();

const sha256n = (d: Buffer | string) => BigInt('0x' + createHash('sha256').update(d).digest('hex'));

function findTransfer(txs: readonly BlockchainTransaction[], from: Address, to: Address): any | null {
    for (const tx of txs) {
        for (const msg of tx.outMessages.values()) {
            const info = (msg as any).info as any;
            if (info.src?.equals(from) && info.dest?.equals(to)) return info;
        }
    }
    return null;
}


describe('Atomic swap happy-path', () => {
    let chain: Blockchain;
    let factory: SandboxContract<EscrowFactory>;
    let lop: SandboxContract<LimitOrderProtocol>;

    beforeEach(async () => {
        chain = await Blockchain.create();
        const t = await chain.treasury('deployer');

        const feeBank = chain.openContract(await FeeBank.fromInit(empty, slice(t.address), slice(t.address)));
        await feeBank.send(t.getSender(), { value: toNano('0.2') }, { $$type: 'Deploy', queryId: 0n });

        factory = chain.openContract(await EscrowFactory.fromInit(t.address, feeBank.address));
        await factory.send(t.getSender(), { value: toNano('0.2') }, { $$type: 'Deploy', queryId: 0n });

        lop = chain.openContract(await LimitOrderProtocol.fromInit(factory.address));
        await lop.send(t.getSender(), { value: toNano('0.2') }, { $$type: 'Deploy', queryId: 0n });

        factory = chain.openContract(await EscrowFactory.fromInit(lop.address, feeBank.address));
        await factory.send(t.getSender(), { value: toNano('0.2') }, { $$type: 'Deploy', queryId: 0n });
    });

    it('Alice ⇄ Bob', async () => {
        const alice = await chain.treasury('alice');
        const bob = await chain.treasury('bob');
        const secret = Buffer.from('super-secret');
        const hash = sha256n(secret);
        const amount = 123n * 10n ** 8n;
        const deposit = toNano('0.5');
        const srcMsg = {
            $$type: 'CreateEscrowSrc' as const,
            maker: slice(alice.address),
            taker: slice(bob.address),
            token: empty,
            amount,
            safetyDeposit: deposit,
            hashlock: hash,
            tlSrcWithdraw: 0n,
            tlSrcPubWithdraw: 0n,
            tlSrcCancel: 0n,
            tlSrcPubCancel: 0n,
            tlRescueStart: 0n,
        };
        await factory.send(alice.getSender(), { value: toNano('10') }, srcMsg);
        const srcAddr = await factory.getAddressOfEscrowSrc(srcMsg);
        const escrowSrc = chain.openContract<EscrowSrc>(EscrowSrc.fromAddress(srcAddr));

        const dstMsg = {
            $$type: 'CreateEscrowDst' as const,
            maker: slice(bob.address),
            taker: slice(alice.address),
            token: empty,
            amount,
            safetyDeposit: deposit,
            hashlock: hash,
            tlDstWithdraw: 0n,
            tlDstPubWithdraw: 0n,
            tlDstCancel: 0n,
            tlRescueStart: 0n,
        };
        await factory.send(bob.getSender(), { value: toNano('10') }, dstMsg);
        const dstAddr = await factory.getAddressOfEscrowDst(dstMsg);
        const escrowDst = chain.openContract<EscrowDst>(EscrowDst.fromAddress(dstAddr));

        const withdraw = { $$type: 'WithdrawPriv' as const, secret: BigInt('0x' + secret.toString('hex')) };
        const txDst = await escrowDst.send(alice.getSender(), { value: toNano('0.1') }, withdraw);

        await lop.send(
            alice.getSender(),
            { value: toNano('0.3') },
            {
                $$type: 'TriggerInteraction',
                order: beginCell().storeUint(amount, 256).endCell(),
                extension: beginCell().endCell(),
                orderHash: 1n,
                taker: bob.address,
                makingAmount: amount,
                takingAmount: amount,
                remainingMakingAmount: 0n,
                extraData: beginCell().endCell(),
            },
        );

        const txSrc = await escrowSrc.send(bob.getSender(), { value: toNano('0.1') }, withdraw);

        const infoDst = findTransfer(txDst.transactions, escrowDst.address, alice.address);
        const infoSrc = findTransfer(txSrc.transactions, escrowSrc.address, bob.address);

        expect(infoDst).not.toBeNull();
        expect(infoSrc).not.toBeNull();
        const minDelivered = toNano('0.05');
        expect(infoDst!.value.coins).toBeGreaterThanOrEqual(minDelivered);
        expect(infoSrc!.value.coins).toBeGreaterThanOrEqual(minDelivered);
    });
});
