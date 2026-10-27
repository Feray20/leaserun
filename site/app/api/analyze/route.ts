import { NextResponse } from 'next/server';
import { AnalysisInputSchema, analyze } from '@/lib/domain/core-analysis';
export async function POST(request:Request){try{const body:unknown=await request.json();const parsed=AnalysisInputSchema.safeParse(body);if(!parsed.success)return NextResponse.json({ok:false,error:'VALIDATION_ERROR',details:parsed.error.flatten()},{status:400});return NextResponse.json({ok:true,analysis:analyze(parsed.data)},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({ok:false,error:'INVALID_REQUEST'},{status:400})}}
