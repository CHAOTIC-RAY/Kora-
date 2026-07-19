import React from "react";
import CassetteVisualizer from "./CassetteVisualizer";

interface AudiobookCassetteCardProps {
  title: string;
  coverUrl?: string;
  grayscaleCovers?: boolean;
  hideCovers?: boolean;
  size?: "card" | "thumb";
  playing?: boolean;
  className?: string;
}

export default function AudiobookCassetteCard(props: AudiobookCassetteCardProps) {
  return <CassetteVisualizer {...props} size={props.size || "card"} />;
}
