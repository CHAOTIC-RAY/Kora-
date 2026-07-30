import React from "react";
import { motion } from "motion/react";

export default function InkSketchScribbleBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 opacity-40 dark:opacity-25 select-none">
      <svg
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        viewBox="0 0 1200 4000"
      >
        <defs>
          <linearGradient id="inkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d4a574" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#8c6239" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#4a3525" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Scribble Doodle Path 1: Top Ebook section */}
        <motion.path
          d="M 100,120 Q 250,90 400,140 T 700,110 T 1000,150"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="6 4"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 2, ease: "easeInOut" }}
        />

        {/* Margin curly bracket left */}
        <motion.path
          d="M 40,300 C 20,350 20,400 35,450 C 50,500 20,550 40,600"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="1.75"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.5, delay: 0.3 }}
        />

        {/* Margin curly bracket right */}
        <motion.path
          d="M 1160,500 C 1180,550 1180,600 1165,650 C 1150,700 1180,750 1160,800"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="1.75"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.5, delay: 0.5 }}
        />

        {/* Hand-drawn circling loop around Workshop */}
        <motion.ellipse
          cx="600"
          cy="1450"
          rx="380"
          ry="110"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="1.5"
          strokeDasharray="8 6"
          transform="rotate(-2 600 1450)"
          initial={{ pathLength: 0, rotate: -10 }}
          whileInView={{ pathLength: 1, rotate: -2 }}
          viewport={{ once: true }}
          transition={{ duration: 2.5 }}
        />

        {/* Dotted connecting line between features */}
        <motion.path
          d="M 200,1900 Q 600,1850 1000,1920 T 300,2400"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="1.5"
          strokeDasharray="4 8"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 3, ease: "easeInOut" }}
        />

        {/* Hand-drawn star doodle 1 */}
        <motion.path
          d="M 150,850 L 158,870 L 180,873 L 164,888 L 168,910 L 150,898 L 132,910 L 136,888 L 120,873 L 142,870 Z"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="1.5"
          initial={{ scale: 0, rotate: -45 }}
          whileInView={{ scale: 1, rotate: 0 }}
          viewport={{ once: true }}
          transition={{ type: "spring", stiffness: 100, damping: 10 }}
        />

        {/* Hand-drawn star doodle 2 */}
        <motion.path
          d="M 1050,2250 L 1056,2265 L 1075,2268 L 1061,2280 L 1065,2298 L 1050,2288 L 1035,2298 L 1039,2280 L 1025,2268 L 1044,2265 Z"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="1.5"
          initial={{ scale: 0, rotate: 45 }}
          whileInView={{ scale: 1, rotate: 0 }}
          viewport={{ once: true }}
          transition={{ type: "spring", stiffness: 100, damping: 10, delay: 0.2 }}
        />

        {/* Squiggly underline sketch 1 */}
        <motion.path
          d="M 350,2900 Q 400,2890 450,2905 T 550,2895 T 650,2905"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2 }}
        />

        {/* Bottom meandering ink divider */}
        <motion.path
          d="M 100,3500 Q 300,3520 600,3495 T 1100,3515"
          fill="none"
          stroke="url(#inkGrad)"
          strokeWidth="2"
          strokeDasharray="5 5"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 2.2 }}
        />
      </svg>
    </div>
  );
}
