import { sendNftLink } from '@tonkeeper/core/dist/service/transfer/nftService';
import { useExecuteContract } from '../useExecuteContract';

export const useLinkNft = () =>
  useExecuteContract(sendNftLink, 'link_dns', 'link-dns');
