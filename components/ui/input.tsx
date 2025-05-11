// Input.tsx
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="border p-2 w-full rounded"
    />
  );
}