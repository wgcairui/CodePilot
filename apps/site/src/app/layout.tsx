import './global.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Geist } from "next/font/google";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: {
    default: 'CodePilot',
    template: '%s | CodePilot',
  },
  description: 'A native desktop GUI client for Claude Code',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
