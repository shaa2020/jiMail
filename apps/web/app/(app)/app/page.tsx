'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homeFor, useMe } from '@/lib/hooks';

export default function AppHome() {
  const { data } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (data) router.replace(homeFor(data));
  }, [data, router]);
  return null;
}
