// Card.tsx
export function Card({ children }: { children: React.ReactNode }) {
  return <div className="border rounded shadow-sm bg-white"> {children} </div>;
}

export function CardContent({ children }: { children: React.ReactNode }) {
  return <div className="p-4"> {children} </div>;
}
