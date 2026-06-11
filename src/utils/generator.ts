import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export const generateReservationNo = (prefix: string = 'R'): string => {
  const date = new Date();
  const dateStr = date.getFullYear().toString() +
    (date.getMonth() + 1).toString().padStart(2, '0') +
    date.getDate().toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}${dateStr}${random}`;
};

export const generateTicketCode = (): string => {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
};

export const generateMemberNo = (): string => {
  const date = new Date();
  const year = date.getFullYear().toString();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `M${year}${random}`;
};

export const generateUUID = (): string => {
  return uuidv4();
};
