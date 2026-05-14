import type { CollaborationSessionSnapshot } from '../shared/ipc';

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const cloneCollaborationSession = (session: CollaborationSessionSnapshot): CollaborationSessionSnapshot => cloneJson(session);