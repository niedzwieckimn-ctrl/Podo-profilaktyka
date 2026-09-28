import {flushMail} from '../lib/mail.js';
// Netlify Scheduled Function nie udostępnia wywołania publicznego na produkcji.
export const handler=async()=>{const result=await flushMail();return {statusCode:200,body:JSON.stringify(result)};};
