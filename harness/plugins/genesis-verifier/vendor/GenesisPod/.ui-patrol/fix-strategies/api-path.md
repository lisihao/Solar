# Fix Strategy: API Path

## Issue

API request returns 404, indicating wrong endpoint path.

## Steps

1. From the network error evidence, identify the failing URL
2. Check backend controller for the correct route:
   - Search `backend/src/modules/` for the controller
   - Verify the `@Controller()` decorator path
   - Verify the method decorator (`@Get()`, `@Post()`, etc.)
3. Check frontend API call:
   - Search `frontend/hooks/` or `frontend/lib/api/` for the API function
   - Fix the endpoint path to match backend
4. Ensure path parameters match (e.g., `:id` vs `{id}`)
5. Run type-check to verify
