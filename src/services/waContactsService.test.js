import { normalizePhoneNumber, parsePasteRows } from './waContactsService';

describe('normalizePhoneNumber', () => {
  test('adds +91 to a bare 10-digit Indian mobile number', () => {
    expect(normalizePhoneNumber('9876543210')).toBe('+919876543210');
  });

  test('strips spaces/dashes/parens and keeps a leading +', () => {
    expect(normalizePhoneNumber('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhoneNumber('(91) 9876543210')).toBe('+919876543210');
  });

  test('strips a trunk 0 prefix and assumes India', () => {
    expect(normalizePhoneNumber('09876543210')).toBe('+919876543210');
  });

  test('adds + to a 12-digit number already carrying the 91 country code', () => {
    expect(normalizePhoneNumber('919876543210')).toBe('+919876543210');
  });

  test('two differently-formatted inputs for the same number normalize identically', () => {
    expect(normalizePhoneNumber('98765 43210')).toBe(normalizePhoneNumber('+91-9876543210'));
  });

  test('empty/null input returns empty string', () => {
    expect(normalizePhoneNumber('')).toBe('');
    expect(normalizePhoneNumber(null)).toBe('');
    expect(normalizePhoneNumber(undefined)).toBe('');
  });
});

describe('parsePasteRows', () => {
  test('a single bare number per line becomes a minimal row', () => {
    const rows = parsePasteRows('9876543210\n9876543211');
    expect(rows).toEqual([
      { contactName: '9876543210', whatsappNumber: '9876543210' },
      { contactName: '9876543211', whatsappNumber: '9876543211' },
    ]);
  });

  test('tab-delimited rows parse name/number/company/email/tags', () => {
    const rows = parsePasteRows('Ravi Sharma\t9876543210\tAcme Cables\travi@acme.com\tvip|geyser');
    expect(rows).toEqual([{
      contactName: 'Ravi Sharma',
      whatsappNumber: '9876543210',
      company: 'Acme Cables',
      email: 'ravi@acme.com',
      tags: ['vip', 'geyser'],
    }]);
  });

  test('comma-delimited rows work when there is no tab', () => {
    const rows = parsePasteRows('Sunita Rao, 9000000002, Bright Industries');
    expect(rows[0]).toMatchObject({ contactName: 'Sunita Rao', whatsappNumber: '9000000002', company: 'Bright Industries' });
  });

  test('blank lines are skipped; empty input returns []', () => {
    expect(parsePasteRows('\n\n9876543210\n\n')).toEqual([{ contactName: '9876543210', whatsappNumber: '9876543210' }]);
    expect(parsePasteRows('')).toEqual([]);
    expect(parsePasteRows(null)).toEqual([]);
  });
});
