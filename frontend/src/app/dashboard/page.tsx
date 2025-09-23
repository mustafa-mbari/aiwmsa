// C:\Dev\Git\AIwmsa\frontend\src\app\dashboard\page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';
import {
  Users,
  FileText,
  Search,
  TrendingUp,
  Package,
  Activity,
  Clock,
  CheckCircle,
  AlertCircle,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { format } from 'date-fns';

interface DashboardStats {
  users: {
    total: number;
    active: number;
    change: number;
  };
  documents: {
    total: number;
    processed: number;
    change: number;
  };
  queries: {
    today: number;
    avgResponseTime: number;
    change: number;
  };
  feedback: {
    avgRating: number;
    total: number;
    change: number;
  };
}

interface RecentActivity {
  id: string;
  type: 'login' | 'upload' | 'query' | 'feedback';
  user: string;
  description: string;
  timestamp: Date;
}

// Mock data for demonstration
const mockStats: DashboardStats = {
  users: { total: 156, active: 142, change: 12 },
  documents: { total: 1234, processed: 1180, change: 8 },
  queries: { today: 89, avgResponseTime: 1.2, change: -5 },
  feedback: { avgRating: 4.5, total: 234, change: 15 },
};

const mockActivities: RecentActivity[] = [
  {
    id: '1',
    type: 'query',
    user: 'John Smith',
    description: 'Searched for "forklift maintenance procedures"',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    id: '2',
    type: 'upload',
    user: 'Sarah Johnson',
    description: 'Uploaded safety_guidelines_2024.pdf',
    timestamp: new Date(Date.now() - 1000 * 60 * 15),
  },
  {
    id: '3',
    type: 'feedback',
    user: 'Mike Wilson',
    description: 'Rated search result 5 stars',
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
  },
  {
    id: '4',
    type: 'login',
    user: 'Emma Davis',
    description: 'Logged in from mobile device',
    timestamp: new Date(Date.now() - 1000 * 60 * 45),
  },
];

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const [stats, setStats] = useState<DashboardStats>(mockStats);
  const [activities, setActivities] = useState<RecentActivity[]>(mockActivities);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch real stats when API is ready
    // fetchDashboardStats();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'login':
        return <Users className="w-4 h-4" />;
      case 'upload':
        return <FileText className="w-4 h-4" />;
      case 'query':
        return <Search className="w-4 h-4" />;
      case 'feedback':
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'login':
        return 'bg-blue-100 text-blue-600';
      case 'upload':
        return 'bg-green-100 text-green-600';
      case 'query':
        return 'bg-purple-100 text-purple-600';
      case 'feedback':
        return 'bg-yellow-100 text-yellow-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const statCards = [
    {
      title: 'Total Users',
      value: stats.users.total,
      subtitle: `${stats.users.active} active`,
      change: stats.users.change,
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      title: 'Documents',
      value: stats.documents.total,
      subtitle: `${stats.documents.processed} processed`,
      change: stats.documents.change,
      icon: FileText,
      color: 'bg-green-500',
    },
    {
      title: 'Queries Today',
      value: stats.queries.today,
      subtitle: `${stats.queries.avgResponseTime}s avg response`,
      change: stats.queries.change,
      icon: Search,
      color: 'bg-purple-500',
    },
    {
      title: 'Avg Rating',
      value: stats.feedback.avgRating.toFixed(1),
      subtitle: `${stats.feedback.total} reviews`,
      change: stats.feedback.change,
      icon: TrendingUp,
      color: 'bg-yellow-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">
          {getGreeting()}, {user?.name}! 👋
        </h1>
        <p className="text-gray-600 mt-1">
          Here's what's happening in your warehouse today
        </p>
        {user?.warehouse && (
          <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
            <Package className="w-4 h-4" />
            <span>{user.warehouse.name} ({user.warehouse.code})</span>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} className="bg-white rounded-lg p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className={`${card.color} p-3 rounded-lg`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div className={`flex items-center gap-1 text-sm ${
                  card.change >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {card.change >= 0 ? (
                    <ArrowUp className="w-4 h-4" />
                  ) : (
                    <ArrowDown className="w-4 h-4" />
                  )}
                  <span>{Math.abs(card.change)}%</span>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900">{card.value}</h3>
              <p className="text-sm text-gray-600 mt-1">{card.title}</p>
              <p className="text-xs text-gray-500 mt-2">{card.subtitle}</p>
            </div>
          );
        })}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Recent Activity
              </h2>
              <button className="text-sm text-blue-600 hover:text-blue-700">
                View all →
              </button>
            </div>
          </div>
          <div className="p-6 space-y-4">
            {activities.map((activity) => (
              <div key={activity.id} className="flex items-start gap-4">
                <div className={`p-2 rounded-lg ${getActivityColor(activity.type)}`}>
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {activity.user}
                  </p>
                  <p className="text-sm text-gray-600">{activity.description}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {format(activity.timestamp, 'h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              Quick Actions
            </h2>
          </div>
          <div className="p-6 space-y-3">
            {user?.role === 'ADMIN' && (
              <>
                <button className="w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-gray-600" />
                    <div>
                      <p className="text-sm font-medium">Add New User</p>
                      <p className="text-xs text-gray-500">
                        Create warehouse account
                      </p>
                    </div>
                  </div>
                </button>
                <button className="w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-600" />
                    <div>
                      <p className="text-sm font-medium">Upload Document</p>
                      <p className="text-xs text-gray-500">
                        Add new knowledge base
                      </p>
                    </div>
                  </div>
                </button>
              </>
            )}
            {user?.role === 'EXPERT' && (
              <button className="w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-gray-600" />
                  <div>
                    <p className="text-sm font-medium">Review Documents</p>
                    <p className="text-xs text-gray-500">
                      Check pending uploads
                    </p>
                  </div>
                </div>
              </button>
            )}
            <button className="w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <Search className="w-5 h-5 text-gray-600" />
                <div>
                  <p className="text-sm font-medium">Search Knowledge</p>
                  <p className="text-xs text-gray-500">
                    Find information quickly
                  </p>
                </div>
              </div>
            </button>
            <button className="w-full text-left p-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-gray-600" />
                <div>
                  <p className="text-sm font-medium">View Analytics</p>
                  <p className="text-xs text-gray-500">
                    Performance insights
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="bg-white rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          System Status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-sm font-medium">API Service</p>
              <p className="text-xs text-gray-500">Operational</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-sm font-medium">Database</p>
              <p className="text-xs text-gray-500">99.9% uptime</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500" />
            <div>
              <p className="text-sm font-medium">AI Processing</p>
              <p className="text-xs text-gray-500">High load</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}