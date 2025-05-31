import { toNano } from '@ton/core';
import { Sample } from '../build/Sample/Sample_Sample';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const sample = provider.open(await Sample.fromInit(BigInt(Math.floor(Math.random() * 10000)), 0n));

    await sample.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(sample.address);

    console.log('ID', await sample.getId());
}
