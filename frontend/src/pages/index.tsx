import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/el-nino-analytics');
  }, [router]);
  return <p style={{ padding: 24 }}>Abrindo El Niño Analytics…</p>;
}
