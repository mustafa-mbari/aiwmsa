# AI WMS Assistant - Backend API

## 📁 Project Structure
```
C:\Dev\Git\AIwmsa\backend\
├── src/
│   ├── config/           # Configuration files
│   ├── middleware/        # Express middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── utils/            # Utility functions
│   ├── types/            # TypeScript types
│   ├── prisma/           # Database schema & migrations
│   ├── app.ts           # Express app setup
│   └── server.ts        # Server entry point
├── dist/                 # Compiled JavaScript
├── tests/               # Test files
├── .env                 # Environment variables
├── .env.example         # Example environment file
├── docker-compose.yml   # Docker services
├── tsconfig.json       # TypeScript config
└── package.json        # Dependencies
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Docker & Docker Compose
- Git

### Installation

1. **Clone the repository**
```bash
cd C:\Dev\Git\AIwmsa
```

2. **Install dependencies**
```bash
cd backend
npm install
```

3. **Setup environment variables**
```bash
copy .env.example .env
# Edit .env with your configuration
```

4. **Start Docker services**
```bash
docker-compose up -d
```

5. **Run database migrations**
```bash
npm run prisma:migrate
npm run prisma:generate
```

6. **Seed the database (optional)**
```bash
npm run prisma:seed
```

7. **Start development server**
```bash
npm run dev
```

## 📝 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start` | Start production server |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:seed` | Seed database with test data |
| `npm run test` | Run tests |
| `npm run lint` | Check code quality |
| `npm run format` | Format code with Prettier |

## 🔗 API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh` - Refresh token
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/change-password` - Change password
- `GET /api/v1/auth/profile` - Get current user

### Users Management
- `GET /api/v1/users` - List all users (Admin)
- `GET /api/v1/users/:id` - Get user details
- `POST /api/v1/users` - Create user (Admin)
- `PATCH /api/v1/users/:id` - Update user
- `DELETE /api/v1/users/:id` - Delete user (Admin)
- `POST /api/v1/users/:id/reset-password` - Reset password (Admin)
- `GET /api/v1/users/stats/overview` - User statistics (Admin)

### Warehouses
- `GET /api/v1/warehouses` - List warehouses
- `GET /api/v1/warehouses/:id` - Get warehouse details
- `POST /api/v1/warehouses` - Create warehouse (Admin)
- `PATCH /api/v1/warehouses/:id` - Update warehouse (Admin)
- `DELETE /api/v1/warehouses/:id` - Delete warehouse (Admin)
- `GET /api/v1/warehouses/:id/stats` - Warehouse statistics
- `GET /api/v1/warehouses/:id/activity` - Activity log

## 🔐 Authentication

The API uses JWT authentication with refresh tokens:

1. Login with email/password to get access & refresh tokens
2. Include access token in Authorization header: `Bearer <token>`
3. Refresh token when access token expires
4. Tokens stored in Redis for session management

### User Roles
- **ADMIN**: Full system access
- **EXPERT**: Document management, analytics
- **WORKER**: Search and query access

## 🗄️ Database Schema

### Main Tables
- `users` - System users
- `warehouses` - Warehouse locations
- `documents` - Uploaded documents
- `document_chunks` - Document segments for search
- `query_logs` - Search history
- `feedback` - User feedback on results

## 🐛 Debugging

### View logs
```bash
# Development logs in console
npm run dev

# Production logs in files
tail -f logs/error.log
tail -f logs/combined.log
```

### Database GUI
```bash
npm run prisma:studio
# Opens at http://localhost:5555
```

### Redis CLI
```bash
docker exec -it aiwmsa-redis redis-cli
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 🚢 Deployment

### Build for production
```bash
npm run build
```

### Run in production
```bash
NODE_ENV=production npm start
```

### Docker deployment
```bash
docker build -t aiwmsa-backend .
docker run -p 5000:5000 aiwmsa-backend
```

## 📚 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment | development |
| `DATABASE_URL` | PostgreSQL connection | - |
| `REDIS_URL` | Redis connection | - |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_REFRESH_SECRET` | Refresh token secret | - |
| `CORS_ORIGIN` | Allowed origins | http://localhost:3000 |

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/amazing-feature`
2. Commit changes: `git commit -m 'Add amazing feature'`
3. Push to branch: `git push origin feature/amazing-feature`
4. Open Pull Request

## 📄 License

ISC License