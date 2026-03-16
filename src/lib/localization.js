// Portugal localization configuration
import { format, formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';

export const PT_LOCALE = 'pt-PT';

// Format date as DD/MM/YYYY using date-fns
export function formatDatePT(date) {
  if (!date) return '';
  return format(new Date(date), 'dd/MM/yyyy', { locale: pt });
}

// Format date and time as DD/MM/YYYY HH:mm using date-fns
export function formatDateTimePT(date) {
  if (!date) return '';
  return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: pt });
}

// Format time as HH:mm:ss
export function formatTimePT(date) {
  if (!date) return '';
  return format(new Date(date), 'HH:mm:ss', { locale: pt });
}

// Format relative time (e.g., "há 2 horas")
export function formatDistancePT(date) {
  if (!date) return '';
  return formatDistanceToNow(new Date(date), { locale: pt, addSuffix: true });
}

// Format number with comma as decimal separator
export function formatNumberPT(num, decimals = 0) {
  if (num === null || num === undefined) return '';
  return num.toFixed(decimals).replace('.', ',');
}

// Format currency in EUR with PT locale
export function formatCurrencyPT(amount) {
  return new Intl.NumberFormat(PT_LOCALE, {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

// Get month name in Portuguese
export function getMonthNamePT(monthIndex) {
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return months[monthIndex] || '';
}

// Get day name in Portuguese
export function getDayNamePT(dayIndex) {
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  return days[dayIndex] || '';
}

// Configure date-fns as default for Portugal
export const ptBRLocale = pt;