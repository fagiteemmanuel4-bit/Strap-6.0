import { createAuthClient } from '@neon/neon-js/auth';

export const authClient = createAuthClient(`${location.origin}/api/neon-auth`);
window.StrapNeonAuth = authClient;
