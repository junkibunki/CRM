import type { RecordModel } from 'pocketbase';

export type CardField = 'company' | 'contacts' | 'expected_close' | 'owner' | 'next_todo';

export const CARD_FIELDS: { key: CardField; label: string }[] = [
	{ key: 'company', label: 'Unternehmen' },
	{ key: 'contacts', label: 'Kontakte' },
	{ key: 'expected_close', label: 'Abschlussdatum' },
	{ key: 'owner', label: 'Zuständig' },
	{ key: 'next_todo', label: 'Nächstes To-Do' }
];

export const DEFAULT_CARD_FIELDS: CardField[] = CARD_FIELDS.map((f) => f.key);

export type ColumnColor = 'gray' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple';

// full class names so Tailwind finds them
export const COLUMN_COLORS: Record<ColumnColor, { label: string; dot: string }> = {
	gray: { label: 'Grau', dot: 'bg-neutral-400' },
	blue: { label: 'Blau', dot: 'bg-blue-500' },
	green: { label: 'Grün', dot: 'bg-emerald-500' },
	yellow: { label: 'Gelb', dot: 'bg-amber-400' },
	orange: { label: 'Orange', dot: 'bg-orange-500' },
	red: { label: 'Rot', dot: 'bg-red-500' },
	purple: { label: 'Lila', dot: 'bg-violet-500' }
};

export interface User extends RecordModel {
	name: string;
	email: string;
}

export interface Company extends RecordModel {
	name: string;
	website: string;
	email: string;
	phone: string;
	address: string;
	notes: string;
}

export interface Contact extends RecordModel {
	first_name: string;
	last_name: string;
	company: string;
	position: string;
	email: string;
	phone: string;
	notes: string;
}

export function contactName(c: Pick<Contact, 'first_name' | 'last_name'>) {
	return [c.first_name, c.last_name].filter(Boolean).join(' ');
}

export interface Board extends RecordModel {
	name: string;
	card_fields: CardField[] | null;
}

/** A stage of the leads pipeline. */
export interface BoardColumn extends RecordModel {
	board: string;
	name: string;
	color: ColumnColor | '';
	wip_limit: number;
	rank: string;
	/** closed stage (e.g. won/lost): no next step expected; added with F7 */
	closed?: boolean;
}

export interface Lead extends RecordModel {
	column: string;
	title: string;
	company: string;
	contacts: string[];
	/** PocketBase date string or '' */
	expected_close: string;
	owner: string;
	rank: string;
	created: string;
}

export type LeadData = Pick<Lead, 'title' | 'company' | 'contacts' | 'expected_close' | 'owner'>;

/** PocketBase date string -> value for <input type="date"> */
export function toDateInput(pbDate: string) {
	return pbDate ? pbDate.slice(0, 10) : '';
}

/** <input type="date"> value -> PocketBase date string */
export function fromDateInput(value: string) {
	return value ? `${value} 00:00:00.000Z` : '';
}

// Drag data passed through Pragmatic DnD
export type CardDragData = { type: 'card'; cardId: string; columnId: string };
export type ColumnDragData = { type: 'column'; columnId: string };
export type CardListDropData = { type: 'card-list'; columnId: string };

export function isCardData(d: Record<string | symbol, unknown>): d is CardDragData {
	return d.type === 'card';
}
export function isColumnData(d: Record<string | symbol, unknown>): d is ColumnDragData {
	return d.type === 'column';
}
export function isCardListData(d: Record<string | symbol, unknown>): d is CardListDropData {
	return d.type === 'card-list';
}
