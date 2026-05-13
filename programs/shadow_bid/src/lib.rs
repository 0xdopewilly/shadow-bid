use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_INIT_AUCTION_STATE: u32 = comp_def_offset("init_auction_state");
const COMP_DEF_OFFSET_PLACE_BID: u32 = comp_def_offset("place_bid");
const COMP_DEF_OFFSET_REVEAL_WINNER: u32 = comp_def_offset("reveal_winner");

/// Byte offset of `encrypted_state` within `Auction` account data (after 8-byte discriminator).
/// `Auction`: 8 (disc) + bump + authority + bid_count + state_nonce, then ciphertext blob.
const ENCRYPTED_STATE_OFFSET: u32 = 61;
/// MXE state is 3 scalars: u64 + u128 + u128 (`SerializedSolanaPublicKey`).
const ENCRYPTED_STATE_SIZE: u32 = 3 * 32;

declare_id!("EvyVpkAWdKABJAZZ73YkMwGiVS3QJMEJ7vHvKh6FYuBt");

#[arcium_program]
pub mod shadow_bid {
    use super::*;

    pub fn init_auction_state_comp_def(ctx: Context<InitAuctionStateCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_place_bid_comp_def(ctx: Context<InitPlaceBidCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_reveal_winner_comp_def(ctx: Context<InitRevealWinnerCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    #[allow(unused_variables)]
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        computation_offset: u64,
        listing_id: u64,
        title: String,
        description: String,
        image_uri: String,
    ) -> Result<()> {
        require!(title.len() <= 64, ErrorCode::TitleTooLong);
        require!(description.len() <= 256, ErrorCode::DescriptionTooLong);
        require!(image_uri.len() <= 200, ErrorCode::ImageUriTooLong);

        let auction = &mut ctx.accounts.auction;
        auction.bump = ctx.bumps.auction;
        auction.authority = ctx.accounts.authority.key();
        auction.bid_count = 0;
        auction.state_nonce = 0;
        auction.encrypted_state = [[0u8; 32]; 3];
        // 0 = no deadline (open). Authority can lock it via set_auction_deadline.
        auction.bidding_ends_at = 0;
        auction.title = title;
        auction.description = description;
        auction.image_uri = image_uri;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new().build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![InitAuctionStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.auction.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_auction_state")]
    pub fn init_auction_state_callback(
        ctx: Context<InitAuctionStateCallback>,
        output: SignedComputationOutputs<InitAuctionStateOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitAuctionStateOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let auction_key = ctx.accounts.auction.key();
        let authority = ctx.accounts.auction.authority;

        let auction = &mut ctx.accounts.auction;
        auction.encrypted_state = o.ciphertexts;
        auction.state_nonce = o.nonce;

        emit!(AuctionCreatedEvent {
            auction: auction_key,
            authority,
        });

        Ok(())
    }

    pub fn place_bid(
        ctx: Context<PlaceBid>,
        computation_offset: u64,
        encrypted_bid: [u8; 32],
        encrypted_bidder_lo: [u8; 32],
        encrypted_bidder_hi: [u8; 32],
        bidder_x25519_pubkey: [u8; 32],
        nonce_bid: u128,
        nonce_bidder: u128,
    ) -> Result<()> {
        // On-chain enforcement: no bids after deadline (if set), no bids after reveal.
        let auction = &ctx.accounts.auction;
        require!(!auction.revealed, ErrorCode::AuctionAlreadyRevealed);
        if auction.bidding_ends_at != 0 {
            let now = Clock::get()?.unix_timestamp;
            require!(now < auction.bidding_ends_at, ErrorCode::AuctionEnded);
        }

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .x25519_pubkey(bidder_x25519_pubkey)
            .plaintext_u128(nonce_bid)
            .encrypted_u64(encrypted_bid)
            .x25519_pubkey(bidder_x25519_pubkey)
            .plaintext_u128(nonce_bidder)
            .encrypted_u128(encrypted_bidder_lo)
            .encrypted_u128(encrypted_bidder_hi)
            .plaintext_u128(ctx.accounts.auction.state_nonce)
            .account(
                ctx.accounts.auction.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![PlaceBidCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.auction.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "place_bid")]
    pub fn place_bid_callback(
        ctx: Context<PlaceBidCallback>,
        output: SignedComputationOutputs<PlaceBidOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(PlaceBidOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let auction_key = ctx.accounts.auction.key();
        let auction = &mut ctx.accounts.auction;
        require!(!auction.revealed, ErrorCode::AuctionAlreadyRevealed);
        // Same bidding window as `place_bid`: do not persist a bid whose
        // computation settles after `bidding_ends_at`.
        if auction.bidding_ends_at != 0 {
            let now = Clock::get()?.unix_timestamp;
            require!(
                now < auction.bidding_ends_at,
                ErrorCode::AuctionEnded
            );
        }
        auction.encrypted_state = o.ciphertexts;
        auction.state_nonce = o.nonce;
        auction.bid_count = auction
            .bid_count
            .checked_add(1)
            .ok_or(ErrorCode::BidCountOverflow)?;

        emit!(BidPlacedEvent {
            auction: auction_key,
            bid_count: auction.bid_count,
        });

        Ok(())
    }

    /// Authority-only: lock an immutable bidding deadline (Unix timestamp, seconds).
    /// Once set, this can never be moved or removed — it's an on-chain promise to
    /// every bidder. After `bidding_ends_at`, `place_bid` rejects.
    pub fn set_auction_deadline(
        ctx: Context<SetAuctionDeadline>,
        bidding_ends_at: i64,
    ) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        require!(!auction.revealed, ErrorCode::AuctionAlreadyRevealed);
        require!(
            auction.bidding_ends_at == 0,
            ErrorCode::DeadlineAlreadySet
        );
        let now = Clock::get()?.unix_timestamp;
        require!(bidding_ends_at > now, ErrorCode::DeadlineMustBeFuture);
        auction.bidding_ends_at = bidding_ends_at;

        emit!(DeadlineSetEvent {
            auction: auction.key(),
            bidding_ends_at,
        });
        Ok(())
    }

    /// Authority-only final reveal: queue an MPC computation that decrypts the
    /// MXE-sealed `AuctionState` into a public output. After this lands, no
    /// further bids are accepted.
    ///
    /// If a deadline has been set, the seller can only reveal AFTER it has
    /// passed — so bidders are guaranteed their bidding window.
    pub fn reveal_winner(ctx: Context<RevealWinner>, computation_offset: u64) -> Result<()> {
        let auction = &ctx.accounts.auction;
        require!(!auction.revealed, ErrorCode::AuctionAlreadyRevealed);
        if auction.bidding_ends_at != 0 {
            let now = Clock::get()?.unix_timestamp;
            require!(
                now >= auction.bidding_ends_at,
                ErrorCode::DeadlineNotReached
            );
        }

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let args = ArgBuilder::new()
            .plaintext_u128(ctx.accounts.auction.state_nonce)
            .account(
                ctx.accounts.auction.key(),
                ENCRYPTED_STATE_OFFSET,
                ENCRYPTED_STATE_SIZE,
            )
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RevealWinnerCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.auction.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "reveal_winner")]
    pub fn reveal_winner_callback(
        ctx: Context<RevealWinnerCallback>,
        output: SignedComputationOutputs<RevealWinnerOutput>,
    ) -> Result<()> {
        let revealed = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RevealWinnerOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Arcis flattens the returned `AuctionState { highest_bid, highest_bidder { lo, hi } }`
        // into anonymous fields: field_0 = highest_bid (u64),
        // field_1 = highest_bidder { field_0 = lo (u128), field_1 = hi (u128) }.
        let winning_bid: u64 = revealed.field_0;
        let bidder_lo: u128 = revealed.field_1.field_0;
        let bidder_hi: u128 = revealed.field_1.field_1;

        let auction_key = ctx.accounts.auction.key();
        let mut winner_bytes = [0u8; 32];
        winner_bytes[0..16].copy_from_slice(&bidder_lo.to_le_bytes());
        winner_bytes[16..32].copy_from_slice(&bidder_hi.to_le_bytes());
        let winner = Pubkey::new_from_array(winner_bytes);

        let auction = &mut ctx.accounts.auction;
        auction.revealed = true;
        auction.winning_bid = winning_bid;
        auction.winner = winner;

        emit!(WinnerRevealedEvent {
            auction: auction_key,
            winner,
            winning_bid,
            total_bids: auction.bid_count,
        });

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub bump: u8,
    pub authority: Pubkey,
    pub bid_count: u32,
    pub state_nonce: u128,
    /// MUST stay at byte offset `ENCRYPTED_STATE_OFFSET` (61). Don't reorder
    /// any field above this line.
    pub encrypted_state: [[u8; 32]; 3],
    pub revealed: bool,
    pub winning_bid: u64,
    pub winner: Pubkey,
    /// Unix timestamp (seconds). 0 = no deadline. Once set to non-zero by
    /// `set_auction_deadline`, this value is immutable on-chain. After this
    /// time, `place_bid` rejects with `AuctionEnded` and `reveal_winner`
    /// becomes callable by the authority.
    pub bidding_ends_at: i64,
    /// Human-readable listing metadata (UTF-8, max 64 / 256 bytes).
    #[max_len(64)]
    pub title: String,
    #[max_len(256)]
    pub description: String,
    /// Optional HTTPS / IPFS gateway URL for listing imagery (UTF-8, max 200 bytes).
    #[max_len(200)]
    pub image_uri: String,
}

#[queue_computation_accounts("init_auction_state", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, listing_id: u64, title: String, description: String, image_uri: String)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Auction::INIT_SPACE,
        seeds = [b"auction", authority.key().as_ref(), &listing_id.to_le_bytes()],
        bump,
    )]
    pub auction: Box<Account<'info, Auction>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_AUCTION_STATE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("init_auction_state")]
#[derive(Accounts)]
pub struct InitAuctionStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_AUCTION_STATE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
}

#[queue_computation_accounts("place_bid", bidder)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(mut)]
    pub auction: Box<Account<'info, Auction>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = bidder,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PLACE_BID))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("place_bid")]
#[derive(Accounts)]
pub struct PlaceBidCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PLACE_BID))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
}

#[init_computation_definition_accounts("init_auction_state", payer)]
#[derive(Accounts)]
pub struct InitAuctionStateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("place_bid", payer)]
#[derive(Accounts)]
pub struct InitPlaceBidCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("reveal_winner", payer)]
#[derive(Accounts)]
pub struct InitRevealWinnerCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("reveal_winner", authority)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RevealWinner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub auction: Box<Account<'info, Auction>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_WINNER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("reveal_winner")]
#[derive(Accounts)]
pub struct RevealWinnerCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_WINNER))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
}

#[derive(Accounts)]
pub struct SetAuctionDeadline<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub auction: Account<'info, Auction>,
}

#[event]
pub struct AuctionCreatedEvent {
    pub auction: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct DeadlineSetEvent {
    pub auction: Pubkey,
    pub bidding_ends_at: i64,
}

#[event]
pub struct BidPlacedEvent {
    pub auction: Pubkey,
    pub bid_count: u32,
}

#[event]
pub struct WinnerRevealedEvent {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub winning_bid: u64,
    pub total_bids: u32,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Bid count overflow")]
    BidCountOverflow,
    #[msg("Auction has already been revealed")]
    AuctionAlreadyRevealed,
    #[msg("Bidding window has ended")]
    AuctionEnded,
    #[msg("Deadline already set — it's immutable")]
    DeadlineAlreadySet,
    #[msg("Deadline must be in the future")]
    DeadlineMustBeFuture,
    #[msg("Bidding window not yet ended")]
    DeadlineNotReached,
    #[msg("Auction title too long (max 64 bytes UTF-8)")]
    TitleTooLong,
    #[msg("Auction description too long (max 256 bytes UTF-8)")]
    DescriptionTooLong,
    #[msg("Auction image URL too long (max 200 bytes UTF-8)")]
    ImageUriTooLong,
}
