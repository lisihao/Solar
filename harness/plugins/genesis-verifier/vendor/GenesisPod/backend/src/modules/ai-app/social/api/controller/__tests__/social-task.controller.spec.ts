import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SocialTaskController } from '../social-task.controller';
import { SocialTaskService } from '../../services/social-task.service';
import type { CreateSocialTaskDto } from '../../api/dto/create-social-task.dto';

function makeService(): jest.Mocked<SocialTaskService> {
  return {
    createTask: jest.fn().mockResolvedValue({ id: 'task-1' }),
    listTasks: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
    getTask: jest.fn().mockResolvedValue({ id: 'task-1', sources: [], versions: [] }),
    cancelTask: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SocialTaskService>;
}

function makeReq(userId?: string) {
  return { user: userId ? { id: userId } : undefined };
}

function makeDto(overrides: Partial<CreateSocialTaskDto> = {}): CreateSocialTaskDto {
  return {
    sources: [{ sourceType: 'ai-research', sourceId: 'src-1' }],
    platforms: ['WECHAT_MP'],
    accountIds: { WECHAT_MP: 'conn-1' },
    ...overrides,
  } as CreateSocialTaskDto;
}

describe('SocialTaskController', () => {
  describe('createTask() — POST /api/v1/ai-social/tasks', () => {
    it('calls service with userId from req.user.id', async () => {
      const svc = makeService();
      const ctrl = new SocialTaskController(svc);

      const result = await ctrl.createTask(makeReq('user-1'), makeDto());

      expect(svc.createTask).toHaveBeenCalledWith(expect.any(Object), 'user-1');
      expect(result).toEqual({ id: 'task-1' });
    });

    it('throws UnauthorizedException when user is not set', async () => {
      const ctrl = new SocialTaskController(makeService());

      await expect(ctrl.createTask(makeReq(), makeDto())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('listTasks() — GET /api/v1/ai-social/tasks', () => {
    it('passes userId and parsed query to service', async () => {
      const svc = makeService();
      const ctrl = new SocialTaskController(svc);

      await ctrl.listTasks(makeReq('user-2'), 'PENDING', 'cursor-x', '10');

      expect(svc.listTasks).toHaveBeenCalledWith('user-2', {
        status: 'PENDING',
        cursor: 'cursor-x',
        limit: 10,
      });
    });

    it('throws UnauthorizedException when user is not set', async () => {
      const ctrl = new SocialTaskController(makeService());

      await expect(ctrl.listTasks(makeReq())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getTask() — GET /api/v1/ai-social/tasks/:id', () => {
    it('passes id and userId to service', async () => {
      const svc = makeService();
      const ctrl = new SocialTaskController(svc);

      await ctrl.getTask(makeReq('user-3'), 'task-99');

      expect(svc.getTask).toHaveBeenCalledWith('task-99', 'user-3');
    });

    it('propagates NotFoundException from service', async () => {
      const svc = makeService();
      svc.getTask.mockRejectedValue(new NotFoundException());
      const ctrl = new SocialTaskController(svc);

      await expect(ctrl.getTask(makeReq('user-3'), 'bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UnauthorizedException when user is not set', async () => {
      const ctrl = new SocialTaskController(makeService());

      await expect(ctrl.getTask(makeReq(), 'task-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('cancelTask() — DELETE /api/v1/ai-social/tasks/:id', () => {
    it('calls service and returns success', async () => {
      const svc = makeService();
      const ctrl = new SocialTaskController(svc);

      const result = await ctrl.cancelTask(makeReq('user-4'), 'task-5');

      expect(svc.cancelTask).toHaveBeenCalledWith('task-5', 'user-4');
      expect(result).toEqual({ success: true });
    });

    it('propagates BadRequestException from service (already PUBLISHED)', async () => {
      const svc = makeService();
      svc.cancelTask.mockRejectedValue(
        new BadRequestException('Cannot cancel task in status: PUBLISHED'),
      );
      const ctrl = new SocialTaskController(svc);

      await expect(ctrl.cancelTask(makeReq('user-4'), 'task-pub')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException when user is not set', async () => {
      const ctrl = new SocialTaskController(makeService());

      await expect(ctrl.cancelTask(makeReq(), 'task-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
