import React from "react";
import { motion } from "motion/react";
import { KoraWordmark } from "./KoraLogo";

export default function KoraLoading() {
  return (
    <div className="flex flex-col items-center justify-center space-y-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ 
          opacity: [0.4, 1, 0.4],
          scale: [0.98, 1, 0.98]
        }}
        transition={{ 
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="flex flex-col items-center"
      >
        <KoraWordmark className="h-12 text-kindle-text" />
        <motion.div 
          className="h-0.5 bg-kindle-accent mt-4 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          transition={{ 
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </motion.div>
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-kindle-text-muted animate-pulse">
        Synchronizing...
      </p>
    </div>
  );
}
