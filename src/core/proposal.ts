import { z } from 'zod';
const text=z.string().trim().min(1).max(3000);
export const proposalSchema=z.object({
  objectives:z.array(text).max(30),
  agenda:z.array(z.object({time:text,activity:text}).strict()).max(50),
  assignments:z.array(z.object({task:text,assignee:text,status:z.enum(['proposed','accepted'])}).strict()).max(100),
  vendors:z.array(z.object({name:text,source:z.url(),contact:text.optional(),services:text,publishedPrice:text.optional(),checkedAt:z.iso.date(),verification:z.enum(['source_reviewed','unverified'])}).strict()).max(30),
  pendingApprovals:z.array(text).max(50),
  unresolvedIssues:z.array(text).max(50),
  invitation:z.object({to:z.array(z.email()).max(100),subject:text,body:z.string().min(1).max(20000).transform(value=>value.replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n')),status:z.literal('draft')}).strict().optional()
}).strict();
export type ProposalContent=z.infer<typeof proposalSchema>;
