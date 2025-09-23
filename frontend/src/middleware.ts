// C:\Dev\Git\AIwmsa\frontend\src\middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public routes that don't require authentication
const publicRoutes = ['/login', '/forgot-password', '/reset-password'];

// Role-based route access
const roleAccess = {
  ADMIN: ['*'], // Admin has access to all routes
  EXPERT: ['/dashboard', '/documents', '/analytics', '/profile', '/settings'],
  WORKER: ['/dashboard', '/search', '/profile'],
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Check if it's a public route
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));
  
  // Get token from cookies or headers
  const token = request.cookies.get('access_token')?.value;
  
  // If no token and trying to access protected route, redirect to login
  if (!token && !isPublicRoute) {
    const url = new URL('/login', request.url);
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }
  
  // If has token and trying to access login, redirect to dashboard
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  
  // For now, we'll allow access if token exists
  // In production, you'd want to verify the JWT and check roles
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};