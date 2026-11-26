'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { get } from './api';

export interface Folder { id: string; name: string; role: string | null; parentId: string | null; totalEmails: number; unreadEmails: number; unreadThreads: number }
export interface Addr { name?: string | null; email: string }
export interface Summary { id: string; threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>; from?: Addr[]; to?: Addr[]; cc?: Addr[]; subject?: string; preview?: string; receivedAt: string; hasAttachment: boolean; threadSize: number }

export function useMailbox() {
  const { mb } = useParams<{ mb: string }>();
  const folders = useQuery<Folder[]>({ queryKey: ['folders', mb], queryFn: () => get(`/webmail/${mb}/folders`), refetchInterval: 60_000 });
  return { mb, folders };
}

export const fmtAddr = (a?: Addr | null) => (a ? (a.name ? `${a.name} <${a.email}>` : a.email) : '');
export const shortAddr = (a?: Addr | null) => (a ? a.name || a.email : '');
