import { PrivyProvider as PrivyProviderWrapper } from '@privy-io/react-auth';
import { ReactNode } from 'react';

interface PrivyProviderProps {
  children: ReactNode;
}

export function PrivyProvider({ children }: PrivyProviderProps) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID || '';

  if (!appId) {
    console.warn('VITE_PRIVY_APP_ID is not set. Authentication will be disabled.');
    return <>{children}</>;
  }

  return (
    <PrivyProviderWrapper
      appId={appId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#007fd4',
          logo: '/logo.png',
        },
        loginMethods: ['wallet', 'email' /*, 'google'*/],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </PrivyProviderWrapper>
  );
}
