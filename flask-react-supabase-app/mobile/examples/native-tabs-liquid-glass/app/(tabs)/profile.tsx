// Leaf tab, same full-bleed pattern as Explore.
import { GlassScrollScreen } from '../../components/GlassScrollScreen';
import { Card } from '../../components/Card';

type Row = { id: string; title: string; body: string };

const ROWS: readonly Row[] = [
  { id: 'listings', title: 'My listings', body: 'Manage the vehicles and plates you have posted.' },
  { id: 'saved', title: 'Saved', body: 'Everything you have favourited in one place.' },
  { id: 'settings', title: 'Settings', body: 'Notifications, appearance and account.' },
  { id: 'privacy', title: 'Privacy', body: 'Control what is shared and stored.' },
  { id: 'about', title: 'About', body: 'App version, terms and support.' },
];

export default function ProfileScreen(): React.JSX.Element {
  return (
    <GlassScrollScreen contentContainerStyle={{ paddingTop: 24 }}>
      {ROWS.map((r) => (
        <Card key={r.id} title={r.title} body={r.body} />
      ))}
    </GlassScrollScreen>
  );
}
