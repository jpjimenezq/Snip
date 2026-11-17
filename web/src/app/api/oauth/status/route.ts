import { NextResponse } from "next/server";
import { isConfigured } from "../_lib";

// Solo booleanos: nunca expone valores de las variables.
export async function GET() {
  return NextResponse.json({
    youtube: isConfigured("youtube"),
    tiktok: isConfigured("tiktok"),
    instagram: isConfigured("instagram"),
    facebook: isConfigured("facebook"),
  });
}
