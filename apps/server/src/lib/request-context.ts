import { requestContext } from '@fastify/request-context';

interface Store {
  sessionId?: string;
  userId?: string;
  vaultToken?: string;
}

export function setRequestIdentity(values: Store): void {
  const store = requestContext.getStore() as Store | undefined;
  if (!store) return;
  Object.assign(store, values);
}

export function currentSessionId(): string | undefined {
  return (requestContext.getStore() as Store | undefined)?.sessionId;
}

export function currentUserId(): string | undefined {
  return (requestContext.getStore() as Store | undefined)?.userId;
}

export function currentVaultToken(): string | undefined {
  return (requestContext.getStore() as Store | undefined)?.vaultToken;
}
