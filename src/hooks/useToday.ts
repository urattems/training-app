import { toLocalDateString } from '../utils/dates';

/** Date locale du jour (`YYYY-MM-DD`), base des périodes 1M · 3M · 6M · 1A. */
export const useToday = (): string => toLocalDateString(new Date());
