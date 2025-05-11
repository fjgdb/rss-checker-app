export function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50 hover:bg-gray-800"
    >
      {children}
    </button>
  );
}