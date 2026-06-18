import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyApprovalPin } from './verify-pin.js';
import * as passwordUtils from '../../../contexts/identity/auth/password.js';

vi.mock('../../../contexts/identity/auth/password.js', () => ({
  verifyPassword: vi.fn()
}));

describe('verifyApprovalPin', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([])
    };
  });

  it('should return null if no users have a valid pin', async () => {
    mockDb.execute.mockResolvedValue([
      { id: 'user-1', pin_hash: 'hash-1' },
      { id: 'user-2', pin_hash: 'hash-2' }
    ]);
    vi.mocked(passwordUtils.verifyPassword).mockResolvedValue(false);

    const result = await verifyApprovalPin(mockDb, 'tenant-1', '1234');
    expect(result).toBeNull();
    expect(passwordUtils.verifyPassword).toHaveBeenCalledTimes(2);
  });

  it('should return the user id if a valid pin is found', async () => {
    mockDb.execute.mockResolvedValue([
      { id: 'user-1', pin_hash: 'hash-1' },
      { id: 'user-2', pin_hash: 'hash-2' }
    ]);
    vi.mocked(passwordUtils.verifyPassword)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await verifyApprovalPin(mockDb, 'tenant-1', '1234');
    expect(result).toBe('user-2');
    expect(passwordUtils.verifyPassword).toHaveBeenCalledTimes(2);
  });
});
