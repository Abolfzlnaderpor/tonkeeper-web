import { Address, Cell, SendMode, internal } from '@ton/core';
import BigNumber from 'bignumber.js';
import { AssetAmount } from '../../entries/crypto/asset/asset-amount';
import { TonAsset } from '../../entries/crypto/asset/ton-asset';
import { AuthKeystone } from '../../entries/password';
import { TonRecipientData } from '../../entries/send';
import { KeystoneSigner } from '../../entries/signer';
import { WalletState } from '../../entries/wallet';
import {
    createTransferMessage,
    externalMessage,
    getServerTime,
    getTTL,
    getTonkeeperQueryId,
    getWalletSeqNo,
    seeIfAddressBounceable,
    seeIfTransferBounceable
} from '../transfer/common';
import {
    jettonTransferAmount,
    jettonTransferBody,
    jettonTransferForwardAmount
} from '../transfer/jettonService';
import { nftTransferBody, nftTransferForwardAmount } from '../transfer/nftService';
import { walletContractFromState } from '../wallet/contractService';
import { APIConfig } from '../../entries/apis';
import { TonConnectTransactionPayload } from '../../entries/tonConnect';
import { toStateInit } from '../transfer/tonService';
import { BlockchainApi } from '../../tonApiV2';

export const createKeystoneTonTransfer = async (
    timestamp: number,
    seqno: number,
    walletState: WalletState,
    recipient: TonRecipientData,
    weiAmount: BigNumber,
    isMax: boolean,
    signer: KeystoneSigner
) => {
    const pathInfo = (walletState.auth as AuthKeystone).info;
    const contract = walletContractFromState(walletState);
    const innerSigner = (message: Cell) => {
        return signer(message, 'transaction', pathInfo);
    };
    const transfer = await contract.createTransferAndSignRequestAsync({
        seqno,
        signer: innerSigner,
        timeout: getTTL(timestamp),
        sendMode: isMax
            ? SendMode.CARRY_ALL_REMAINING_BALANCE + SendMode.IGNORE_ERRORS
            : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages: [
            internal({
                to: Address.parse(recipient.toAccount.address),
                bounce: seeIfTransferBounceable(recipient.toAccount, recipient.address),
                value: BigInt(weiAmount.toFixed(0)),
                body: recipient.comment !== '' ? recipient.comment : undefined
            })
        ]
    });

    return externalMessage(contract, seqno, transfer).toBoc();
};

export const createKeystoneNftTransfer = async (
    timestamp: number,
    seqno: number,
    walletState: WalletState,
    recipientAddress: string,
    nftAddress: string,
    nftTransferAmount: bigint,
    forwardPayload: Cell | null,
    signer: KeystoneSigner
) => {
    const pathInfo = (walletState.auth as AuthKeystone).info;
    const innerSigner = (message: Cell) => {
        return signer(message, 'transaction', pathInfo);
    };
    const body = nftTransferBody({
        queryId: getTonkeeperQueryId(),
        newOwnerAddress: Address.parse(recipientAddress),
        responseAddress: Address.parse(walletState.active.rawAddress),
        forwardAmount: nftTransferForwardAmount,
        forwardPayload
    });

    return createTransferMessage(
        { timestamp, seqno, state: walletState, signer: innerSigner },
        { to: nftAddress, value: nftTransferAmount, body }
    );
};

export const createKeystoneJettonTransfer = async (
    timestamp: number,
    seqno: number,
    walletState: WalletState,
    recipientAddress: string,
    amount: AssetAmount<TonAsset>,
    jettonWalletAddress: string,
    forwardPayload: Cell | null,
    signer: KeystoneSigner
) => {
    const jettonAmount = BigInt(amount.stringWeiAmount);

    const pathInfo = (walletState.auth as AuthKeystone).info;
    const innerSigner = (message: Cell) => {
        return signer(message, 'transaction', pathInfo);
    };

    const body = jettonTransferBody({
        queryId: getTonkeeperQueryId(),
        jettonAmount,
        toAddress: Address.parse(recipientAddress),
        responseAddress: Address.parse(walletState.active.rawAddress),
        forwardAmount: jettonTransferForwardAmount,
        forwardPayload
    });

    const contract = walletContractFromState(walletState);
    const transfer = await contract.createTransferAndSignRequestAsync({
        seqno,
        signer: innerSigner,
        timeout: getTTL(timestamp),
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages: [
            internal({
                to: Address.parse(jettonWalletAddress),
                bounce: true,
                value: jettonTransferAmount,
                body: body
            })
        ]
    });

    return externalMessage(contract, seqno, transfer).toBoc();
};

export const sendKeystoneTonConnectTransfer = async (
    api: APIConfig,
    walletState: WalletState,
    params: TonConnectTransactionPayload,
    signer: KeystoneSigner
) => {
    const timestamp = await getServerTime(api);
    const seqno = await getWalletSeqNo(api, walletState.active.rawAddress);

    const external = await createKeystoneTonConnectTransfer(timestamp, seqno, walletState, params, signer);

    const boc = external.toString('base64');

    await new BlockchainApi(api.tonApiV2).sendBlockchainMessage({
        sendBlockchainMessageRequest: { boc }
    });

    return boc;
};

const createKeystoneTonConnectTransfer = async (
    timestamp: number,
    seqno: number,
    walletState: WalletState,
    params: TonConnectTransactionPayload,
    signer: KeystoneSigner
) => {
    const contract = walletContractFromState(walletState);

    const pathInfo = (walletState.auth as AuthKeystone).info;
    const innerSigner = (message: Cell) => {
        return signer(message, 'transaction', pathInfo);
    };

    const transfer = await contract.createTransferAndSignRequestAsync({
        seqno,
        signer: innerSigner,
        timeout: getTTL(timestamp),
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages: params.messages.map(item =>
            internal({
                to: Address.parse(item.address),
                bounce: seeIfAddressBounceable(item.address),
                value: BigInt(item.amount),
                init: toStateInit(item.stateInit),
                body: item.payload ? Cell.fromBase64(item.payload) : undefined
            })
        )
    });
    return externalMessage(contract, seqno, transfer).toBoc({ idx: false });
};