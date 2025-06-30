'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, getContractsForNetwork, STAKING_ABI, TOKEN_ABI, BSC_TESTNET_CHAIN_ID, BSC_TESTNET_CONFIG,  HARDHAT_CONFIG, NETWORK_CONFIG } from '@/config/contracts';
import { UserData, WalletState, BNBFeeInfo } from '@/types';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { userService, stakeLogsService } from '@/lib/supabase';

// Types
interface Stake {
  id: bigint;
  amount: bigint;
  timestamp: bigint;
  isActive: boolean;
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

export const useWallet = () => {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  
  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    address: '',
    loading: false,
    error: ''
  });
  
  const [userData, setUserData] = useState<UserData>({
    address: '',
    tokenBalance: '0',
    stakedAmount: '0',
    pendingRewards: '0',
    stakes: [],
    bnbBalance: '0',
    feeInfo: undefined,
    minimumStakingPeriod: '0'
  });

  const [contracts, setContracts] = useState<{
    staking: ethers.Contract | null;
    token: ethers.Contract | null;
  }>({
    staking: null,
    token: null
  });



  const setError = (error: string) => {
    setWalletState(prev => ({ ...prev, error }));
    setTimeout(() => setWalletState(prev => ({ ...prev, error: '' })), 5000);
  };

  const setLoading = useCallback((loading: boolean) => {
    setWalletState(prev => ({ ...prev, loading }));
  }, []);

  // Network detection and switching
  const getCurrentNetwork = useCallback(async () => {
    if (!walletClient) return null;
    
    try {
      const chainId = await walletClient.request({ method: 'eth_chainId' });
      return parseInt(chainId, 16);
    } catch (error) {
      console.error('Error getting network:', error);
      return null;
    }
  }, [walletClient]);

  const switchToNetwork = useCallback(async (targetChainId: string, config: any) => {
    try {
      if (walletClient) {
        await walletClient.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        });
      }
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        // Network not found, add it
        await walletClient?.request({
          method: 'wallet_addEthereumChain',
          params: [config]
        });
      }
    }
  }, [walletClient]);

  const switchToTargetNetwork = useCallback(async () => {
    const currentChainId = await getCurrentNetwork();
    
    // Check if we're already on BSC testnet
    if (currentChainId === 97) {
      console.log('✅ Already on BSC testnet');
      return;
    }
    
    // Try to switch to BSC testnet
    try {
      console.log('🔄 Attempting to switch to BSC testnet...');
      await switchToNetwork('0x61', {
        chainId: '0x61',
        chainName: 'BSC Testnet',
        nativeCurrency: {
          name: 'BNB',
          symbol: 'tBNB',
          decimals: 18
        },
        rpcUrls: ['https://data-seed-prebsc-1-s1.binance.org:8545'],
        blockExplorerUrls: ['https://testnet.bscscan.com']
      });
    } catch (error) {
      console.error('❌ Failed to switch to BSC testnet');
      setError('Please manually switch to BSC Testnet (Chain ID: 97)');
    }
  }, [getCurrentNetwork, switchToNetwork]);

  const loadUserData = useCallback(async (stakingContract: ethers.Contract, tokenContract: ethers.Contract, userAddress: string) => {
    try {
      // Get current network and contracts for logging
      const currentChainId = await (stakingContract.runner?.provider as ethers.BrowserProvider)?.send('eth_chainId', []);
      const chainId = parseInt(currentChainId, 16);
      const networkContracts = getContractsForNetwork(chainId);
      
      console.log('🔍 Loading user data for address:', userAddress);
      console.log('📍 Network Chain ID:', chainId);
      console.log('📍 Token contract address:', networkContracts.TOKEN);
      console.log('📍 Staking contract address:', networkContracts.STAKING);

      // Get provider for BNB balance
      const provider = stakingContract.runner?.provider as ethers.BrowserProvider;

      // Get BNB balance
      console.log('💰 Getting BNB balance...');
      const bnbBalance = await provider.getBalance(userAddress);
      const formattedBNBBalance = ethers.formatEther(bnbBalance);
      console.log('💰 BNB balance:', formattedBNBBalance);

      // Get BNB fee information
      console.log('💰 Getting BNB fee info...');
      const feeInfo = await stakingContract.getBNBFeeInfo();
      const bnbFeeInfo: BNBFeeInfo = {
        stakingFeeBNB: feeInfo[0].toString(),
        unstakingFeeBNB: feeInfo[1].toString(),
        feeRecipient: feeInfo[2],
        totalBNBFeesCollected: feeInfo[3].toString(),
        maxFeeBNB: feeInfo[4].toString()
      };
      console.log('💰 BNB fee info:', bnbFeeInfo);

      // Get minimum staking period
      console.log('⏰ Getting minimum staking period...');
      const minPeriod = await stakingContract.minimumStakingPeriod();
      const minimumStakingPeriod = minPeriod.toString();
      console.log('⏰ Minimum staking period:', minimumStakingPeriod, 'seconds');

      // Get token balance
      console.log('💰 Getting token balance...');
      const balance = await tokenContract.balanceOf(userAddress);
      console.log('💰 Raw token balance:', balance.toString());
      
      const tokenBalance = ethers.formatEther(balance);
      console.log('💰 Formatted token balance:', tokenBalance);

      // Get staking history with REAL contract structure
      console.log('📊 Getting staking history...');
      const stakingHistory = await stakingContract.getUserStakingHistory(userAddress);
      console.log('📊 Raw staking history - checking types...');

      // Real contract returns: [userTotalStaked, totalRewardsClaimed, currentRewards, totalActiveStakes, activeStakes]
      const userTotalStaked = stakingHistory[0];
      const totalRewardsClaimed = stakingHistory[1]; 
      const currentRewards = stakingHistory[2];
      const totalActiveStakes = stakingHistory[3];
      const rawActiveStakes = stakingHistory[4];

      // Convert BigInt values to strings for JSON serialization
      const activeStakes = rawActiveStakes.map((stake: any) => ({
        amount: stake.amount.toString(),
        timestamp: stake.timestamp.toString(),
        rewardDebt: stake.rewardDebt.toString(),
        isActive: stake.isActive,
        stakeId: stake.stakeId.toString()
      }));

      const stakedAmount = ethers.formatEther(userTotalStaked);
      const pendingRewards = ethers.formatEther(currentRewards);

      console.log('✅ Parsed staking data:', {
        userTotalStaked: stakedAmount,
        totalRewardsClaimed: ethers.formatEther(totalRewardsClaimed),
        currentRewards: pendingRewards,
        totalActiveStakes: totalActiveStakes.toString(),
        activeStakesCount: activeStakes.length
      });

      // Log each active stake with correct structure (now serializable)
      console.log('🎯 Active Stakes Details:');
      activeStakes.forEach((stake: any, index: number) => {
        console.log(`🎯 Active Stake ${index + 1}:`, {
          stakeId: stake.stakeId,
          amount: ethers.formatEther(stake.amount),
          timestamp: stake.timestamp,
          isActive: stake.isActive,
          rewardDebt: ethers.formatEther(stake.rewardDebt),
          date: new Date(Number(stake.timestamp) * 1000).toLocaleString()
        });
      });

      setUserData({
        address: userAddress,
        tokenBalance,
        stakedAmount,
        pendingRewards,
        stakes: activeStakes, // Now serializable - no BigInt values!
        bnbBalance: formattedBNBBalance,
        feeInfo: bnbFeeInfo,
        minimumStakingPeriod
      });

    } catch (error: any) {
      console.error('❌ Error loading user data:', error);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
      
      // Set default values on error
      setUserData({
        address: userAddress,
        tokenBalance: '0',
        stakedAmount: '0',
        pendingRewards: '0',
        stakes: [],
        bnbBalance: '0',
        feeInfo: undefined,
        minimumStakingPeriod: '0'
      });
      
      setError('Veri yükleme hatası: ' + error.message);
    }
  }, [setError]);

  useEffect(() => {
    if (isConnected && address) {
      setWalletState(prev => ({
        ...prev,
        isConnected: true,
        address: address
      }));

      const initializeContracts = async () => {
        try {
          setLoading(true);
          // Remove automatic network switching
          // await switchToTargetNetwork();

          // Create a signer provider using the connected wallet (for WRITE operations only)
          const signerProvider = new ethers.BrowserProvider(walletClient as any);
          const signer = await signerProvider.getSigner();

          // --- READ-ONLY provider (no wallet — prevents unwanted pop-ups) ---
          const PUBLIC_BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545';
          const readProvider = new ethers.JsonRpcProvider(PUBLIC_BSC_TESTNET_RPC);

          // Always use BSC Testnet contract addresses for read/write (adjust if multi-chain later)
          const networkContracts = getContractsForNetwork(97);

          console.log('🌐 Contracts (BSC Testnet):', networkContracts);

          // READ-ONLY contract instances (attached to public RPC)
          const stakingRead = new ethers.Contract(
            networkContracts.STAKING,
            STAKING_ABI,
            readProvider
          );

          const tokenRead = new ethers.Contract(
            networkContracts.TOKEN,
            TOKEN_ABI,
            readProvider
          );

          // WRITE contract instances (connected to user signer)
          const stakingWrite = stakingRead.connect(signer);
          const tokenWrite = tokenRead.connect(signer);

          // Save write-enabled contracts to state – UI actions will use these
          setContracts({
            staking: stakingWrite as unknown as ethers.Contract,
            token: tokenWrite as unknown as ethers.Contract,
          });

          // Fetch on-chain data using READ-ONLY contracts (does NOT trigger wallet pop-up)
          await loadUserData(
            stakingRead as unknown as ethers.Contract,
            tokenRead as unknown as ethers.Contract,
            address
          );
        } catch (error: any) {
          console.error('Contract initialization error:', error);
          setError(error.message);
        } finally {
          setLoading(false);
        }
      };

      initializeContracts();
    } else {
      setWalletState(prev => ({
        ...prev,
        isConnected: false,
        address: '',
        loading: false  // Set loading to false when wallet is not connected
      }));
    }
  }, [isConnected, address, walletClient]);



  // Token approve işlemi
  const approveTokens = async (amount: string) => {
    if (!contracts.token || !contracts.staking || !amount || parseFloat(amount) <= 0) {
      setError('Geçerli bir miktar girin');
      return false;
    }

    try {
      setLoading(true);
      
      // Get staking contract address dynamically
      const stakingAddress = await contracts.staking.getAddress();
      const tx = await contracts.token.approve(stakingAddress, ethers.parseEther(amount));
      await tx.wait();
      
      await loadUserData(contracts.staking!, contracts.token!, walletState.address);
      return true;
    } catch (error: any) {
      setError('Token onayı başarısız: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Stake işlemi - Now with BNB fee
  const stakeTokens = async (amount: string) => {
    if (!contracts.staking || !amount || parseFloat(amount) <= 0) {
      setError('Geçerli bir miktar girin');
      return false;
    }

    try {
      setLoading(true);
      
      // Get staking fee from userData
      const stakingFee = userData.feeInfo?.stakingFeeBNB || '0';
      
      // Call stake function with BNB fee as value
      const tx = await contracts.staking.stake(ethers.parseEther(amount), {
        value: stakingFee
      });
      
      console.log('📤 Stake transaction sent:', tx.hash);
      
      // Save stake log to database immediately after transaction is sent
      try {
        const user = await userService.getUserByWallet(walletState.address);
        if (user) {
          await stakeLogsService.addStakeLog({
            user_id: user.id,
            transaction_hash: tx.hash,
            amount: amount,
            action_type: 'stake',
            status: 'pending'
          });
          console.log('✅ Stake log saved to database');
        }
      } catch (dbError) {
        console.error('❌ Error saving stake log to database:', dbError);
        // Don't fail the stake operation if database save fails
      }
      
      const receipt = await tx.wait();
      console.log('✅ Stake transaction confirmed:', receipt.hash);
      
      // Update stake log status to confirmed
      try {
        console.log('🔄 STAKE - Attempting to update log status:', {
          transactionHash: tx.hash,
          status: 'confirmed',
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed?.toString(),
          gasPrice: receipt.gasPrice?.toString()
        });
        
        const updateResult = await stakeLogsService.updateStakeLogStatus(
          tx.hash,
          'confirmed',
          receipt.blockNumber || undefined,
          receipt.gasUsed?.toString(),
          receipt.gasPrice?.toString()
        );
        
        console.log('✅ STAKE - Log status update result:', updateResult);
      } catch (dbError) {
        console.error('❌ STAKE - CRITICAL ERROR updating stake log status:', dbError);
        console.error('❌ STAKE - Transaction hash:', tx.hash);
        console.error('❌ STAKE - Receipt:', receipt);
      }
      
      await loadUserData(contracts.staking!, contracts.token!, walletState.address);
      return true;
    } catch (error: any) {
      console.error('❌ Stake error:', error);
      setError('Stake işlemi başarısız: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Ödül alma işlemi
  const claimRewards = async () => {
    if (!contracts.staking) {
      setError('Kontrat bağlantısı yok');
      return false;
    }

    try {
      setLoading(true);
      
      const tx = await contracts.staking.claimRewards();
      console.log('📤 Claim rewards transaction sent:', tx.hash);
      
      // Save claim log to database immediately after transaction is sent
      try {
        const user = await userService.getUserByWallet(walletState.address);
        if (user) {
          await stakeLogsService.addStakeLog({
            user_id: user.id,
            transaction_hash: tx.hash,
            amount: '0', // Claim rewards doesn't have a specific amount
            action_type: 'claim_rewards',
            status: 'pending'
          });
          console.log('✅ Claim rewards log saved to database');
        }
      } catch (dbError) {
        console.error('❌ Error saving claim rewards log to database:', dbError);
      }
      
      const receipt = await tx.wait();
      console.log('✅ Claim rewards transaction confirmed:', receipt.hash);
      
      // Update claim log status to confirmed
      try {
        await stakeLogsService.updateStakeLogStatus(
          tx.hash,
          'confirmed',
          receipt.blockNumber || undefined,
          receipt.gasUsed?.toString(),
          receipt.gasPrice?.toString()
        );
        console.log('✅ Claim rewards log status updated to confirmed');
      } catch (dbError) {
        console.error('❌ Error updating claim rewards log status:', dbError);
      }
      
      await loadUserData(contracts.staking!, contracts.token!, walletState.address);
      return true;
    } catch (error: any) {
      console.error('❌ Claim rewards error:', error);
      setError('Ödül talep etme başarısız: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Unstake işlemi (stake ID ile) - Now with BNB fee
  const unstakeTokens = async (stakeId: string) => {
    if (!contracts.staking || !stakeId) {
      setError('Geçerli bir stake ID girin');
      return false;
    }

    try {
      setLoading(true);
      
      console.log('🔄 Starting unstake process...');
      console.log('📋 Stake ID:', stakeId);
      
      // Convert stakeId to integer for the contract
      const stakeIdInt = parseInt(stakeId);
      if (isNaN(stakeIdInt)) {
        throw new Error(`Invalid stake ID: ${stakeId}`);
      }
      
      console.log('🔢 Converted stake ID to integer:', stakeIdInt);
      
      // Get unstaking fee from userData
      const unstakingFee = userData.feeInfo?.unstakingFeeBNB || '0';
      console.log('💰 Unstaking fee required:', unstakingFee, 'wei');
      console.log('💰 Unstaking fee formatted:', ethers.formatEther(unstakingFee), 'BNB');
      
      // Check if we have enough BNB
      const currentBNB = ethers.parseEther(userData.bnbBalance || '0');
      const requiredFee = BigInt(unstakingFee);
      
      console.log('💰 Current BNB balance:', ethers.formatEther(currentBNB), 'BNB');
      console.log('💰 Required fee:', ethers.formatEther(requiredFee), 'BNB');
      
      if (currentBNB < requiredFee) {
        throw new Error(`Insufficient BNB for fee. Required: ${ethers.formatEther(requiredFee)} BNB, Available: ${ethers.formatEther(currentBNB)} BNB`);
      }
      
      // Call withdraw function with BNB fee as value
      console.log('📤 Calling withdraw function...');
      const tx = await contracts.staking.withdraw(stakeIdInt, {
        value: unstakingFee
      });
      
      console.log('⏳ Transaction sent, waiting for confirmation...');
      console.log('🔗 Transaction hash:', tx.hash);
      
      // Save unstake log to database immediately after transaction is sent
      try {
        const user = await userService.getUserByWallet(walletState.address);
        if (user) {
          // Get the stake amount from userData for this specific stake
          const stake = userData.stakes.find(s => s.stakeId.toString() === stakeId);
          const stakeAmount = stake ? ethers.formatEther(stake.amount) : '0';
          
          await stakeLogsService.addStakeLog({
            user_id: user.id,
            transaction_hash: tx.hash,
            amount: stakeAmount,
            action_type: 'unstake',
            status: 'pending'
          });
          console.log('✅ Unstake log saved to database');
        }
      } catch (dbError) {
        console.error('❌ Error saving unstake log to database:', dbError);
      }
      
      const receipt = await tx.wait();
      console.log('✅ Transaction confirmed:', receipt.hash);
      
      // Update unstake log status to confirmed
      try {
        console.log('🔄 UNSTAKE - Attempting to update log status:', {
          transactionHash: tx.hash,
          status: 'confirmed',
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed?.toString(),
          gasPrice: receipt.gasPrice?.toString()
        });
        
        const updateResult = await stakeLogsService.updateStakeLogStatus(
          tx.hash,
          'confirmed',
          receipt.blockNumber || undefined,
          receipt.gasUsed?.toString(),
          receipt.gasPrice?.toString()
        );
        
        console.log('✅ UNSTAKE - Log status update result:', updateResult);
      } catch (dbError) {
        console.error('❌ UNSTAKE - CRITICAL ERROR updating unstake log status:', dbError);
        console.error('❌ UNSTAKE - Transaction hash:', tx.hash);
        console.error('❌ UNSTAKE - Receipt:', receipt);
      }
      
      await loadUserData(contracts.staking!, contracts.token!, walletState.address);
      return true;
    } catch (error: any) {
      console.error('❌ Unstake error details:', {
        message: error.message,
        code: error.code,
        data: error.data,
        reason: error.reason
      });
      setError('Stake çekme başarısız: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Emergency withdraw function
  const emergencyWithdraw = async (stakeId: string) => {
    if (!contracts.staking || !stakeId) {
      setError('Geçerli bir stake ID girin');
      return false;
    }

    try {
      setLoading(true);
      
      console.log('🚨 Starting emergency withdraw...');
      console.log('📋 Stake ID:', stakeId);
      
      // Convert stakeId to integer for the contract
      const stakeIdInt = parseInt(stakeId);
      if (isNaN(stakeIdInt)) {
        throw new Error(`Invalid stake ID: ${stakeId}`);
      }
      
      console.log('🔢 Converted stake ID to integer:', stakeIdInt);
      
      // Get unstaking fee from userData (emergency withdraw also requires fee)
      const unstakingFee = userData.feeInfo?.unstakingFeeBNB || '0';
      console.log('💰 Emergency withdraw fee required:', unstakingFee, 'wei');
      
      // Call emergencyWithdraw function with BNB fee as value
      console.log('📤 Calling emergencyWithdraw function...');
      const tx = await contracts.staking.emergencyWithdraw(stakeIdInt, {
        value: unstakingFee
      });
      
      console.log('⏳ Emergency withdraw transaction sent...');
      console.log('🔗 Transaction hash:', tx.hash);
      
      // Save emergency withdraw log to database immediately after transaction is sent
      try {
        const user = await userService.getUserByWallet(walletState.address);
        if (user) {
          // Get the stake amount from userData for this specific stake
          const stake = userData.stakes.find(s => s.stakeId.toString() === stakeId);
          const stakeAmount = stake ? ethers.formatEther(stake.amount) : '0';
          
          await stakeLogsService.addStakeLog({
            user_id: user.id,
            transaction_hash: tx.hash,
            amount: stakeAmount,
            action_type: 'emergency_withdraw',
            status: 'pending'
          });
          console.log('✅ Emergency withdraw log saved to database');
        }
      } catch (dbError) {
        console.error('❌ Error saving emergency withdraw log to database:', dbError);
      }
      
      const receipt = await tx.wait();
      console.log('✅ Emergency withdraw confirmed:', receipt.hash);
      
      // Update emergency withdraw log status to confirmed
      try {
        await stakeLogsService.updateStakeLogStatus(
          tx.hash,
          'confirmed',
          receipt.blockNumber || undefined,
          receipt.gasUsed?.toString(),
          receipt.gasPrice?.toString()
        );
        console.log('✅ Emergency withdraw log status updated to confirmed');
      } catch (dbError) {
        console.error('❌ Error updating emergency withdraw log status:', dbError);
      }
      
      await loadUserData(contracts.staking!, contracts.token!, walletState.address);
      return true;
    } catch (error: any) {
      console.error('❌ Emergency withdraw error details:', {
        message: error.message,
        code: error.code,
        data: error.data,
        reason: error.reason
      });
      setError('Acil çekim başarısız: ' + error.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Allowance kontrol etme
  const getAllowance = async () => {
    if (!contracts.token || !contracts.staking || !walletState.address) return '0';

    try {
      const stakingAddress = await contracts.staking.getAddress();
      const allowance = await contracts.token.allowance(walletState.address, stakingAddress);
      return ethers.formatEther(allowance);
    } catch (error) {
      console.error('Allowance kontrol hatası:', error);
      return '0';
    }
  };

  return {
    walletState,
    userData,
    contracts,
    connectWallet: async () => {
      try {
        setLoading(true);
        await window.ethereum.request({ method: 'eth_requestAccounts' });
      } catch (error: any) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    },
    approveTokens,
    stakeTokens,
    claimRewards,
    unstakeTokens,
    emergencyWithdraw,
    getAllowance,
    setError,
    setLoading
  };
}; 