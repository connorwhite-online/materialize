import Head from 'next/head'
import styles from '@/styles/Home.module.css'
import Link from 'next/link';
import useAuth from '../hooks/useAuth';

export default function Home() {
  const user = useAuth();
  console.log(user);

  return (
    <>
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Materialize" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <div>
        {user ? (
          <Link href="/profile">
            <a>Go to Profile</a>
          </Link>
        ) : (
          <Link href="/login">
            <a>Login</a>
          </Link>
        )}
        </div>
      </main>
    </>
  )
}
