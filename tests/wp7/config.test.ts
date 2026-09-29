import { describe, expect, it } from 'vitest';
import { createTestContext } from '../helpers.js';
import { AdminError, getConfigSummary, setAnnounceChannel, setTimezone } from '../../src/services/admin.js';
import { listAudit } from '../../src/db/repos/audit.js';

describe('services/admin config', () => {
  it('sets the announce channel and audits it', () => {
    const ctx = createTestContext();
    setAnnounceChannel(ctx, 'actor', '123456789012345678');
    expect(getConfigSummary(ctx).announceChannelId).toBe('123456789012345678');
    expect(listAudit(ctx, 1)[0]?.action).toBe('admin:config:channel');
  });

  it('accepts a valid IANA timezone', () => {
    const ctx = createTestContext();
    setTimezone(ctx, 'actor', 'Asia/Tokyo');
    expect(getConfigSummary(ctx).timezone).toBe('Asia/Tokyo');
    expect(listAudit(ctx, 1)[0]?.action).toBe('admin:config:timezone');
  });

  it('rejects an invalid timezone and does not change the stored value', () => {
    const ctx = createTestContext({ timezone: 'Europe/Moscow' });
    expect(() => setTimezone(ctx, 'actor', 'Not/A_Zone')).toThrow(AdminError);
    expect(getConfigSummary(ctx).timezone).toBe('Europe/Moscow');
  });
});
