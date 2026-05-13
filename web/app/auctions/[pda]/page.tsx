"use client";

import { AuctionDetailPage } from "@/components/shadow-bid/pages/AuctionDetailPage";
import { use } from "react";

export default function AuctionDetail({
  params,
}: {
  params: Promise<{ pda: string }>;
}) {
  const { pda } = use(params);
  return <AuctionDetailPage auctionPda={pda} />;
}
