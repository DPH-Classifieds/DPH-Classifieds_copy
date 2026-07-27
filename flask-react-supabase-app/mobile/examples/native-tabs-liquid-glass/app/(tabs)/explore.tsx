// Leaf tab (no per-tab stack, so no header). Still full-bleed: the list scrolls
// beneath the Liquid Glass tab bar and blurs against it.
import { GlassScrollScreen } from '../../components/GlassScrollScreen';
import { Card } from '../../components/Card';

type Category = { id: string; title: string; body: string };

const CATEGORIES: readonly Category[] = [
  { id: 'cars', title: 'Cars', body: 'Browse the latest listings across every make and model.' },
  { id: 'bikes', title: 'Bikes', body: 'Sport, cruiser and off-road bikes from verified sellers.' },
  { id: 'plates', title: 'Plates', body: 'Premium and dateless registration plates.' },
  { id: 'parts', title: 'Parts', body: 'OEM and aftermarket parts, filtered by fitment.' },
  { id: 'dealers', title: 'Dealers', body: 'Trusted dealerships with full inventories.' },
  { id: 'requests', title: 'Buying requests', body: 'Post what you want and let sellers come to you.' },
];

export default function ExploreScreen(): React.JSX.Element {
  return (
    <GlassScrollScreen contentContainerStyle={{ paddingTop: 24 }}>
      {CATEGORIES.map((c) => (
        <Card key={c.id} title={c.title} body={c.body} />
      ))}
    </GlassScrollScreen>
  );
}
