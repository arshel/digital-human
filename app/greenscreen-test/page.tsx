import { notFound } from "next/navigation";
import { GreenscreenLab } from "@/components/GreenscreenLab";
import "./lab.css";

// Alleen tijdens `npm run dev`: Nova vrijstaand testen met testmateriaal, zonder Anam.
export default function GreenscreenTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <GreenscreenLab />;
}
