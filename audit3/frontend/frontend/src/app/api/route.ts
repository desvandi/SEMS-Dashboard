import { NextResponse } from "next/server";

// P2-API-04: Proper health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'SEMS Frontend',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
